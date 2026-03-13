// 🚛 Controle de Pátio - Transportadora Print
// Sistema desenvolvido e mantido por Ramalho Sistemas e Software

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const isProduction = process.env.NODE_ENV === 'production' && process.env.DATABASE_URL;

let pool = null;
let db = null;

if (isProduction) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('💾 Banco: PostgreSQL (Produção)');
} else {
    const Database = require('better-sqlite3');
    const dbDir = path.join(__dirname, 'database');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(path.join(dbDir, 'patio.db'));
    console.log('💾 Banco: SQLite (Desenvolvimento)');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
console.log('🔧 Iniciando servidor...');
console.log(`🌐 Ambiente: ${isProduction ? 'Produção' : 'Desenvolvimento'}`);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

function mapPostgresRow(row) {
    if (!row) return null;
    return {
        id: row.id, plate: row.plate, type: row.type, yard: row.yard, base: row.base,
        baseDestino: row.basedestino || '',
        manager: row.manager, chassis: row.chassis, status: row.status,
        maintenance: row.maintenance, maintenanceCategory: row.maintenancecategory || '',
        hasAccident: row.hasaccident || false, sascarStatus: row.sascarstatus || 'pendente',
        keys: row.keys, notes: row.notes,
        entregarDiversos: row.entregar_diversos || false,
        entregarCorreios: row.entregar_correios || false,
        entregue: row.entregue || false, entreguePara: row.entreguepara || '',
        readyTime: row.readytime, entryTime: row.entrytime, exitTime: row.exittime,
        createdAt: row.createdat, updatedAt: row.updatedat, updatedBy: row.updatedby
    };
}

function mapUserRow(row) {
    if (!row) return null;
    return {
        id: row.id, username: row.username,
        passwordHash: row.passwordhash || row.password_hash,
        role: row.role,
        yards: row.yards ? (typeof row.yards === 'string' ? JSON.parse(row.yards) : row.yards) : [],
        createdAt: row.createdat, lastLogin: row.lastlogin
    };
}

function mapSwapRow(row) {
    if (!row) return null;
    return {
        id: row.id, date: row.date, plateIn: row.platein, plateOut: row.plateout,
        base: row.base, baseDestino: row.basedestino || '', notes: row.notes, tipo: row.tipo || 'troca',
        createdAt: row.createdat, updatedBy: row.updatedby
    };
}

const userYardPermissions = {
    admin: ['Pátio Jaraguá', 'Pátio Bandeirantes', 'Pátio Superior', 'Pátio Cajamar'],
    cajamar: ['Pátio Cajamar'],
    bandeirantes: ['Pátio Bandeirantes'],
    jaragua: ['Pátio Jaraguá', 'Pátio Superior']
};

function getUserAllowedYards(username) {
    return userYardPermissions[username.toLowerCase()] || [];
}

function filterVehiclesByUserYards(vehicles, username) {
    const allowedYards = getUserAllowedYards(username);
    if (allowedYards.length === 0) return vehicles;
    return vehicles.filter(v => allowedYards.includes(v.yard));
}

function canChangeLiberadoStatus(user) {
    return user.role === 'admin' || 
           user.username?.toLowerCase() === 'bandeirantes' || 
           user.username?.toLowerCase() === 'jaragua' ||
           (user.yards || []).includes('Pátio Bandeirantes') ||
           (user.yards || []).includes('Pátio Jaraguá');
}

async function initDatabase() {
    if (isProduction) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS vehicles (
                    id SERIAL PRIMARY KEY,
                    plate TEXT NOT NULL, type TEXT NOT NULL, yard TEXT NOT NULL,
                    base TEXT DEFAULT 'Jaraguá-SP (Nacional)', baseDestino TEXT DEFAULT '',
                    manager TEXT DEFAULT '', chassis TEXT DEFAULT '',
                    status TEXT DEFAULT 'Aguardando linha',
                    maintenance BOOLEAN DEFAULT false, maintenanceCategory TEXT DEFAULT '',
                    hasAccident BOOLEAN DEFAULT false, sascarStatus TEXT DEFAULT 'pendente',
                    keys TEXT DEFAULT '', notes TEXT DEFAULT '',
                    entregar_diversos BOOLEAN DEFAULT false,
                    entregar_correios BOOLEAN DEFAULT false,
                    entregue BOOLEAN DEFAULT false, entreguePara TEXT DEFAULT '',
                    readyTime TIMESTAMP, entryTime TIMESTAMP NOT NULL, exitTime TIMESTAMP,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS swaps (
                    id SERIAL PRIMARY KEY,
                    date TIMESTAMP NOT NULL,
                    plateIn TEXT DEFAULT '0000', plateOut TEXT NOT NULL,
                    base TEXT DEFAULT '', baseDestino TEXT DEFAULT '',
                    notes TEXT DEFAULT '', tipo TEXT DEFAULT 'troca',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    passwordHash TEXT NOT NULL,
                    role TEXT DEFAULT 'operator',
                    yards JSONB DEFAULT '[]',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    lastLogin TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
                CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
            `);
            
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hasAccident BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sascarStatus TEXT DEFAULT 'pendente'`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS maintenanceCategory TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS readyTime TIMESTAMP`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregar_diversos BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregar_correios BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregue BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entreguePara TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS baseDestino TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'troca'`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS baseDestino TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS yards JSONB DEFAULT '[]'`);
            
            const users = [
                { username: 'admin', password: process.env.ADMIN_PASSWORD || 'Print@2026', role: 'admin', yards: ['Pátio Jaraguá', 'Pátio Bandeirantes', 'Pátio Superior', 'Pátio Cajamar'] },
                { username: 'cajamar', password: process.env.CAJAMAR_PASSWORD || 'Cajamar2026', role: 'operator', yards: ['Pátio Cajamar'] },
                { username: 'bandeirantes', password: process.env.BANDEIRANTES_PASSWORD || 'Bandeirantes2026', role: 'operator', yards: ['Pátio Bandeirantes'] },
                { username: 'jaragua', password: process.env.JARAGUA_PASSWORD || 'Jaragua2026', role: 'operator', yards: ['Pátio Jaraguá', 'Pátio Superior'] }
            ];
            
            for (const user of users) {
                const exists = await pool.query('SELECT id FROM users WHERE username = $1', [user.username]);
                if (exists.rows.length === 0) {
                    const hash = bcrypt.hashSync(user.password, 10);
                    await pool.query('INSERT INTO users (username, passwordHash, role, yards) VALUES ($1, $2, $3, $4)', [user.username, hash, user.role, JSON.stringify(user.yards)]);
                }
            }
            console.log('✅ PostgreSQL inicializado');
        } catch (err) { console.error('❌ Erro PostgreSQL:', err.message); }
    } else {
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS vehicles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plate TEXT NOT NULL, type TEXT NOT NULL, yard TEXT NOT NULL,
                    base TEXT DEFAULT 'Jaraguá-SP (Nacional)', baseDestino TEXT DEFAULT '',
                    manager TEXT DEFAULT '', chassis TEXT DEFAULT '',
                    status TEXT DEFAULT 'Aguardando linha',
                    maintenance INTEGER DEFAULT 0, maintenanceCategory TEXT DEFAULT '',
                    hasAccident INTEGER DEFAULT 0, sascarStatus TEXT DEFAULT 'pendente',
                    keys TEXT DEFAULT '', notes TEXT DEFAULT '',
                    entregar_diversos INTEGER DEFAULT 0,
                    entregar_correios INTEGER DEFAULT 0,
                    entregue INTEGER DEFAULT 0, entreguePara TEXT DEFAULT '',
                    readyTime TEXT, entryTime TEXT NOT NULL, exitTime TEXT,
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS swaps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    plateIn TEXT DEFAULT '0000', plateOut TEXT NOT NULL,
                    base TEXT DEFAULT '', baseDestino TEXT DEFAULT '',
                    notes TEXT DEFAULT '', tipo TEXT DEFAULT 'troca',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    passwordHash TEXT NOT NULL,
                    role TEXT DEFAULT 'operator',
                    yards TEXT DEFAULT '[]',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    lastLogin TEXT
                );
            `);
            
            try { db.exec('ALTER TABLE vehicles ADD COLUMN manager TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN chassis TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN hasAccident INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN sascarStatus TEXT DEFAULT "pendente"'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN maintenanceCategory TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN readyTime TEXT'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregar_diversos INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregar_correios INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregue INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entreguePara TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN baseDestino TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN tipo TEXT DEFAULT "troca"'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN baseDestino TEXT DEFAULT ""'); } catch(e) {}
            
            const users = [
                { username: 'admin', password: process.env.ADMIN_PASSWORD || 'Print@2026', role: 'admin', yards: ['Pátio Jaraguá', 'Pátio Bandeirantes', 'Pátio Superior', 'Pátio Cajamar'] },
                { username: 'cajamar', password: process.env.CAJAMAR_PASSWORD || 'Cajamar2026', role: 'operator', yards: ['Pátio Cajamar'] },
                { username: 'bandeirantes', password: process.env.BANDEIRANTES_PASSWORD || 'Bandeirantes2026', role: 'operator', yards: ['Pátio Bandeirantes'] },
                { username: 'jaragua', password: process.env.JARAGUA_PASSWORD || 'Jaragua2026', role: 'operator', yards: ['Pátio Jaraguá', 'Pátio Superior'] }
            ];
            
            for (const user of users) {
                const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(user.username);
                if (!exists) {
                    const hash = bcrypt.hashSync(user.password, 10);
                    db.prepare('INSERT INTO users (username, passwordHash, role, yards) VALUES (?, ?, ?, ?)').run(user.username, hash, user.role, JSON.stringify(user.yards));
                }
            }
            console.log('✅ SQLite inicializado');
        } catch (err) { console.error('❌ Erro SQLite:', err.message); }
    }
}

initDatabase();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'print2026secretkey123456789',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProduction, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) { next(); }
    else { res.status(401).json({ error: 'Não autenticado' }); }
};

const requireRole = (allowedRoles) => (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!allowedRoles.includes(req.session.user.role)) return res.status(403).json({ error: 'Acesso negado' });
    next();
};

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    try {
        let user;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
            user = mapUserRow(result.rows[0]);
        } else {
            user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
            if (user && user.yards) user.yards = typeof user.yards === 'string' ? JSON.parse(user.yards) : user.yards;
        }
        if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        const passwordValid = bcrypt.compareSync(password, user.passwordHash);
        if (!passwordValid) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        const allowedYards = getUserAllowedYards(user.username);
        req.session.user = { id: user.id, username: user.username, role: user.role, yards: allowedYards };
        res.json({ success: true, user: { username: user.username, role: user.role, yards: allowedYards }, message: `Bem-vindo, ${user.username}!` });
    } catch (error) {
        console.error('❌ Erro no login:', error.message);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/auth/me', (req, res) => {
    if (req.session?.user) {
        res.json({ authenticated: true, user: req.session.user, permissions: getPermissions(req.session.user.role), canChangeLiberado: canChangeLiberadoStatus(req.session.user) });
    } else { res.json({ authenticated: false }); }
});

function getPermissions(role) {
    return {
        admin: { canDelete: true, canImport: true, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: true, canUndoLiberado: true },
        bandeirantes: { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: false, canUndoLiberado: true },
        jaragua: { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: false, canUndoLiberado: true },
        cajamar: { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: false, canUndoLiberado: false },
        operator: { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: false, canUndoLiberado: false }
    }[role] || { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true, canManage: false, canUndoLiberado: false };
}

app.get('/api/vehicles', requireAuth, async (req, res) => {
    try {
        let vehicles;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM vehicles ORDER BY entryTime DESC');
            vehicles = result.rows.map(mapPostgresRow);
        } else {
            vehicles = db.prepare('SELECT * FROM vehicles ORDER BY entryTime DESC').all();
        }
        vehicles = filterVehiclesByUserYards(vehicles, req.session.user.username);
        res.json(vehicles.map(v => ({
            ...v,
            entryDate: formatDateBR(v.entryTime),
            exitDate: v.exitTime ? formatDateBR(v.exitTime) : null,
            timeInYard: calculateTimeInYard(v.entryTime, v.exitTime),
            timeReady: v.readyTime ? calculateTimeInYard(v.readyTime, null) : null,
            canChangeLiberado: canChangeLiberadoStatus(req.session.user)
        })));
    } catch (err) {
        console.error('Erro ao listar veículos:', err);
        res.status(500).json({ error: 'Erro ao buscar veículos' });
    }
});

app.post('/api/vehicles', requireAuth, async (req, res) => {
    const { plate, type, yard, base, baseDestino, manager, chassis, keys, notes, entryDate, entregarDiversos, entregarCorreios, hasAccident, sascarStatus, maintenanceCategory } = req.body;
    const allowedYards = getUserAllowedYards(req.session.user.username);
    if (allowedYards.length > 0 && !allowedYards.includes(yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    if (!plate && !chassis) return res.status(400).json({ error: 'Placa ou Chassi obrigatórios' });
    if (!type || !yard) return res.status(400).json({ error: 'Tipo e pátio obrigatórios' });
    try {
        if (isProduction) {
            const result = await pool.query(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, keys, notes, entregar_diversos, entregar_correios, hasAccident, sascarStatus, maintenanceCategory, entryTime, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
                [plate ? plate.toUpperCase() : '', type, yard, base || 'Jaraguá-SP (Nacional)', baseDestino || '', manager || '', chassis || '', keys || '', notes || '', entregarDiversos ? true : false, entregarCorreios ? true : false, hasAccident ? true : false, sascarStatus || 'pendente', maintenanceCategory || '', entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), req.session.user.username]);
            res.json(mapPostgresRow(result.rows[0]));
        } else {
            const stmt = db.prepare(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, keys, notes, entregar_diversos, entregar_correios, hasAccident, sascarStatus, maintenanceCategory, entryTime, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const result = stmt.run(plate ? plate.toUpperCase() : '', type, yard, base || 'Jaraguá-SP (Nacional)', baseDestino || '', manager || '', chassis || '', keys || '', notes || '', entregarDiversos ? 1 : 0, entregarCorreios ? 1 : 0, hasAccident ? 1 : 0, sascarStatus || 'pendente', maintenanceCategory || '', entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), req.session.user.username);
            res.json({ ...db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid) });
        }
    } catch (err) {
        console.error('Erro ao criar veículo:', err);
        res.status(500).json({ error: 'Erro ao criar veículo' });
    }
});

app.put('/api/vehicles/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const canEditDates = req.session.user.role === 'admin' || req.session.user.username?.toLowerCase() === 'bandeirantes' || (req.session.user.yards || []).includes('Pátio Bandeirantes');
    if (updates.yard) {
        const allowedYards = getUserAllowedYards(req.session.user.username);
        if (allowedYards.length > 0 && !allowedYards.includes(updates.yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    }
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET plate = COALESCE($1::TEXT, plate), type = COALESCE($2::TEXT, type), yard = COALESCE($3::TEXT, yard), base = COALESCE($4::TEXT, base), baseDestino = COALESCE($5::TEXT, baseDestino), manager = COALESCE($6::TEXT, manager), chassis = COALESCE($7::TEXT, chassis), status = COALESCE($8::TEXT, status), maintenance = COALESCE($9::BOOLEAN, maintenance), hasAccident = COALESCE($10::BOOLEAN, hasAccident), sascarStatus = COALESCE($11::TEXT, sascarStatus), maintenanceCategory = COALESCE($12::TEXT, maintenanceCategory), notes = COALESCE($13::TEXT, notes), entregar_diversos = COALESCE($14::BOOLEAN, entregar_diversos), entregar_correios = COALESCE($15::BOOLEAN, entregar_correios), entregue = COALESCE($16::BOOLEAN, entregue), entreguePara = COALESCE($17::TEXT, entreguePara), entryTime = CASE WHEN $18::TEXT IS NOT NULL AND ${canEditDates} THEN $18::TIMESTAMP ELSE entryTime END, exitTime = CASE WHEN $19::TEXT IS NOT NULL AND ${canEditDates} THEN $19::TIMESTAMP ELSE exitTime END, updatedAt = CURRENT_TIMESTAMP, updatedBy = $20::TEXT WHERE id = $21::INTEGER`,
                [updates.plate || null, updates.type || null, updates.yard || null, updates.base || null, updates.baseDestino || null, updates.manager || null, updates.chassis || null, updates.status || null, updates.maintenance !== undefined ? Boolean(updates.maintenance) : null, updates.hasAccident !== undefined ? Boolean(updates.hasAccident) : null, updates.sascarStatus || null, updates.maintenanceCategory || null, updates.notes || null, updates.entregarDiversos !== undefined ? Boolean(updates.entregarDiversos) : null, updates.entregarCorreios !== undefined ? Boolean(updates.entregarCorreios) : null, updates.entregue !== undefined ? Boolean(updates.entregue) : null, updates.entreguePara || null, canEditDates && updates.entryTime ? updates.entryTime : null, canEditDates && updates.exitTime ? updates.exitTime : null, req.session.user.username, id]);
        } else {
            db.prepare(`UPDATE vehicles SET plate = ?, type = ?, yard = ?, base = ?, baseDestino = ?, manager = ?, chassis = ?, status = ?, maintenance = ?, hasAccident = ?, sascarStatus = ?, maintenanceCategory = ?, notes = ?, entregar_diversos = ?, entregar_correios = ?, entregue = ?, entreguePara = ?, entryTime = ?, exitTime = ?, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
                updates.plate || null, updates.type || null, updates.yard || null, updates.base || null, updates.baseDestino || null, updates.manager || null, updates.chassis || null, updates.status || null,
                updates.maintenance ? 1 : 0, updates.hasAccident ? 1 : 0, updates.sascarStatus || 'pendente', updates.maintenanceCategory || '', updates.notes || null,
                updates.entregarDiversos ? 1 : 0, updates.entregarCorreios ? 1 : 0, updates.entregue ? 1 : 0, updates.entreguePara || '',
                canEditDates && updates.entryTime ? updates.entryTime : null, canEditDates && updates.exitTime ? updates.exitTime : null,
                new Date().toISOString(), req.session.user.username, id);
        }
        res.json({ success: true, message: 'Veículo atualizado com sucesso' });
    } catch (err) {
        console.error('❌ Erro ao atualizar:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar veículo: ' + err.message });
    }
});

app.put('/api/vehicles/:id/entregue', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { entreguePara } = req.body;
    if (!['correios', 'diversos'].includes(entreguePara)) {
        return res.status(400).json({ error: 'Tipo de entrega inválido' });
    }
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET entregue = true, entreguePara = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`, [entreguePara, id]);
        } else {
            db.prepare(`UPDATE vehicles SET entregue = 1, entreguePara = ?, updatedAt = ? WHERE id = ?`).run(entreguePara, new Date().toISOString(), id);
        }
        res.json({ success: true, message: 'Veículo marcado como entregue!' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao marcar como entregue: ' + err.message });
    }
});

app.put('/api/vehicles/:id/undo-liberado', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { newStatus } = req.body;
    const canChangeLiberado = canChangeLiberadoStatus(req.session.user);
    if (!canChangeLiberado) return res.status(403).json({ error: 'Apenas admin, Bandeirantes e Jaraguá podem desfazer liberação' });
    const validStatuses = ['Aguardando linha', 'Aguardando abastecimento', 'Aguardando manutenção', 'Em manutenção', 'Borracharia'];
    if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: 'Status inválido' });
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = $1, readyTime = NULL, exitTime = NULL, updatedAt = CURRENT_TIMESTAMP, updatedBy = $2 WHERE id = $3`, [newStatus, req.session.user.username, id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = ?, readyTime = NULL, exitTime = NULL, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(newStatus, new Date().toISOString(), req.session.user.username, id);
        }
        res.json({ success: true, message: 'Liberação desfeita com sucesso' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao desfazer liberação: ' + err.message });
    }
});

app.put('/api/vehicles/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['Aguardando linha', 'Aguardando abastecimento', 'Aguardando manutenção', 'Em manutenção', 'Borracharia', 'Liberado', 'Sinistro'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = $1, maintenance = $2, updatedAt = CURRENT_TIMESTAMP WHERE id = $3`, [status, status === 'Em manutenção' || status === 'Borracharia', id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = ?, maintenance = ?, updatedAt = ? WHERE id = ?`).run(status, (status === 'Em manutenção' || status === 'Borracharia') ? 1 : 0, new Date().toISOString(), id);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar status' }); }
});

app.post('/api/vehicles/:id/exit', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = 'Liberado', exitTime = CURRENT_TIMESTAMP, readyTime = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = 'Liberado', exitTime = ?, readyTime = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), id);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao registrar saída' }); }
});

app.delete('/api/vehicles/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) { await pool.query('DELETE FROM vehicles WHERE id = $1', [id]); }
        else { db.prepare('DELETE FROM vehicles WHERE id = ?').run(id); }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao deletar' }); }
});

app.get('/api/swaps', requireAuth, async (req, res) => {
    try {
        let swaps;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM swaps ORDER BY date DESC LIMIT 100');
            swaps = result.rows.map(mapSwapRow);
        } else {
            swaps = db.prepare('SELECT * FROM swaps ORDER BY date DESC LIMIT 100').all();
        }
        res.json(swaps.map(s => ({ ...s, dateFormatted: formatDateBR(s.date) })));
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar trocas' }); }
});

app.post('/api/swaps', requireAuth, async (req, res) => {
    const { date, plateIn, plateOut, base, baseDestino, notes, tipo, entregarVeiculoSaida } = req.body;
    try {
        let swapResult;
        if (isProduction) {
            const result = await pool.query(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [date ? new Date(date).toISOString() : new Date().toISOString(), plateIn?.toUpperCase() || '0000', plateOut?.toUpperCase() || '0000', base || '', baseDestino || '', notes || '', tipo || 'troca', req.session.user.username]);
            swapResult = mapSwapRow(result.rows[0]);
        } else {
            const stmt = db.prepare(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            const result = stmt.run(date ? new Date(date).toISOString() : new Date().toISOString(), plateIn?.toUpperCase() || '0000', plateOut?.toUpperCase() || '0000', base || '', baseDestino || '', notes || '', tipo || 'troca', req.session.user.username);
            swapResult = db.prepare('SELECT * FROM swaps WHERE id = ?').get(result.lastInsertRowid);
        }
        
        let vehicleMarkedAsEntregue = false;
        if (entregarVeiculoSaida && plateOut) {
            if (isProduction) {
                await pool.query(`UPDATE vehicles SET entregue = true, entreguePara = $1, status = 'Liberado', exitTime = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE plate = $2`, [entregarVeiculoSaida, plateOut.toUpperCase()]);
            } else {
                db.prepare(`UPDATE vehicles SET entregue = 1, entreguePara = ?, status = 'Liberado', exitTime = ?, updatedAt = ? WHERE plate = ?`).run(entregarVeiculoSaida, new Date().toISOString(), new Date().toISOString(), plateOut.toUpperCase());
            }
            vehicleMarkedAsEntregue = true;
        }
        
        res.json({ success: true, ...swapResult, dateFormatted: formatDateBR(swapResult.date), vehicleMarkedAsEntregue, plateInAuto: plateIn?.toUpperCase() || '' });
    } catch (err) {
        console.error('Erro ao criar troca:', err);
        res.status(500).json({ error: 'Erro ao criar troca: ' + err.message });
    }
});

app.put('/api/swaps/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        if (isProduction) {
            await pool.query(`UPDATE swaps SET date = COALESCE($1, date), plateIn = COALESCE($2, plateIn), plateOut = COALESCE($3, plateOut), base = COALESCE($4, base), baseDestino = COALESCE($5, baseDestino), notes = COALESCE($6, notes), tipo = COALESCE($7, tipo) WHERE id = $8`,
                [updates.date ? new Date(updates.date).toISOString() : null, updates.plateIn, updates.plateOut, updates.base, updates.baseDestino || null, updates.notes, updates.tipo, id]);
        } else {
            db.prepare(`UPDATE swaps SET date = ?, plateIn = ?, plateOut = ?, base = ?, baseDestino = ?, notes = ?, tipo = ? WHERE id = ?`).run(
                updates.date ? new Date(updates.date).toISOString() : null, updates.plateIn, updates.plateOut, updates.base, updates.baseDestino || null, updates.notes, updates.tipo || 'troca', id);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

app.delete('/api/swaps/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) { await pool.query('DELETE FROM swaps WHERE id = $1', [id]); }
        else { db.prepare('DELETE FROM swaps WHERE id = ?').run(id); }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao deletar' }); }
});

app.get('/api/management/dashboard', requireAuth, async (req, res) => {
    try {
        let allVehicles;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM vehicles');
            allVehicles = result.rows.map(mapPostgresRow);
        } else {
            allVehicles = db.prepare('SELECT * FROM vehicles').all();
        }
        const vehicles = filterVehiclesByUserYards(allVehicles, req.session.user.username);
        const now = new Date();
        const readyVehicles = vehicles.filter(v => v.status === 'Liberado');
        const sascarPendente = vehicles.filter(v => v.sascarStatus === 'pendente').length;
        const sascarManutencao = vehicles.filter(v => v.sascarStatus === 'manutencao').length;
        const sascarInstalado = vehicles.filter(v => v.sascarStatus === 'instalado').length;
        const maintenanceByCategory = {
            mecanica: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'mecanica').length,
            bau: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'bau').length,
            borracharia: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'borracharia').length,
            eletrica: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'eletrica').length,
            freios: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'freios').length
        };
        const readyTimes = readyVehicles.filter(v => v.readyTime).map(v => (now - new Date(v.readyTime)) / (1000 * 60 * 60));
        const avgReadyTime = readyTimes.length > 0 ? (readyTimes.reduce((a, b) => a + b, 0) / readyTimes.length).toFixed(1) : 0;
        const stalledVehicles = vehicles.filter(v => v.status !== 'Liberado' && (now - new Date(v.entryTime)) / (1000 * 60 * 60) > 24);
        const entreguesCorreios = vehicles.filter(v => v.entregue && v.entreguePara === 'correios').length;
        const entreguesDiversos = vehicles.filter(v => v.entregue && v.entreguePara === 'diversos').length;
        
        res.json({
            totalVehicles: vehicles.length,
            readyVehicles: readyVehicles.length,
            activeVehicles: vehicles.filter(v => v.status !== 'Liberado').length,
            maintenanceByCategory,
            sascarStatus: { pendente: sascarPendente, manutencao: sascarManutencao, instalado: sascarInstalado },
            avgReadyTime,
            stalledVehicles: stalledVehicles.length,
            entreguesCorreios,
            entreguesDiversos,
            readyVehiclesList: readyVehicles.map(v => ({
                id: v.id, plate: v.plate, type: v.type, yard: v.yard, base: v.base, baseDestino: v.baseDestino,
                readyTime: v.readyTime,
                timeReady: v.readyTime || '—',
                hoursReady: v.readyTime ? ((now - new Date(v.readyTime)) / (1000 * 60 * 60)).toFixed(1) : 0,
                sascarStatus: v.sascarStatus,
                entregue: v.entregue,
                entreguePara: v.entreguePara
            })).sort((a, b) => parseFloat(b.hoursReady) - parseFloat(a.hoursReady)),
            sascarPendenteList: vehicles.filter(v => v.sascarStatus === 'pendente' || v.sascarStatus === 'manutencao').map(v => ({
                id: v.id, plate: v.plate, type: v.type, yard: v.yard,
                sascarStatus: v.sascarStatus, status: v.status
            }))
        });
    } catch (err) {
        console.error('Erro no dashboard gerência:', err);
        res.status(500).json({ error: 'Erro ao buscar dashboard' });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        let allVehicles;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM vehicles');
            allVehicles = result.rows.map(mapPostgresRow);
        } else {
            allVehicles = db.prepare('SELECT * FROM vehicles').all();
        }
        const vehicles = filterVehiclesByUserYards(allVehicles, req.session.user.username);
        const active = vehicles.filter(v => v.status !== 'Liberado');
        const liberated = vehicles.filter(v => v.status === 'Liberado');
        const entreguesDiversos = liberated.filter(v => v.entregarDiversos).length;
        const entreguesCorreios = liberated.filter(v => v.entregarCorreios).length;
        const comSinistro = vehicles.filter(v => v.hasAccident).length;
        const now = new Date();
        const stalledVehicles = active.filter(v => (now - new Date(v.entryTime)) / (1000 * 60 * 60) > 24 && v.status === 'Aguardando linha');
        res.json({
            cavalosMecanicos: active.filter(v => v.type === 'Cavalo Mecânico').length,
            carretas: active.filter(v => v.type === 'Carreta').length,
            emManutencao: active.filter(v => v.status === 'Em manutenção').length,
            emBorracharia: active.filter(v => v.status === 'Borracharia').length,
            liberados: liberated.length,
            entreguesDiversos,
            entreguesCorreios,
            comSinistro,
            totalAtivos: active.length,
            totalGeral: active.length + liberated.length,
            stalledVehicles: stalledVehicles.length,
            stalledVehiclesList: stalledVehicles.map(v => ({ id: v.id, plate: v.plate, hours: Math.round((now - new Date(v.entryTime)) / (1000 * 60 * 60)) })),
            lastUpdated: new Date().toISOString()
        });
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar estatísticas' }); }
});

app.post('/api/import', requireAuth, requireRole(['admin']), async (req, res) => {
    const { vehicles: importedVehicles, swaps: importedSwaps } = req.body;
    if (!Array.isArray(importedVehicles)) return res.status(400).json({ error: 'Dados devem conter: {"vehicles": [...]} ' });
    try {
        if (isProduction) {
            await pool.query('DELETE FROM vehicles');
            await pool.query('DELETE FROM swaps');
            for (const v of importedVehicles) {
                if (v.plate || v.chassis) {
                    await pool.query(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, status, maintenance, maintenanceCategory, hasAccident, sascarStatus, keys, notes, entregar_diversos, entregar_correios, entregue, entreguePara, readyTime, entryTime, exitTime, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
                        [v.plate ? v.plate.toUpperCase() : '', v.type, v.yard, v.base || 'Jaraguá-SP (Nacional)', v.baseDestino || '', v.manager || '', v.chassis || '', v.status || 'Aguardando linha', v.maintenance || false, v.maintenanceCategory || '', v.hasAccident || false, v.sascarStatus || 'pendente', v.keys || '', v.notes || '', v.entregarDiversos || false, v.entregarCorreios || false, v.entregue || false, v.entreguePara || '', v.readyTime || null, v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username]);
                }
            }
            if (Array.isArray(importedSwaps) && importedSwaps.length > 0) {
                for (const s of importedSwaps) {
                    if (s.plateOut) {
                        await pool.query(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                            [s.date || new Date().toISOString(), s.plateIn || '0000', s.plateOut, s.base || '', s.baseDestino || '', s.notes || '', s.tipo || 'troca', req.session.user.username]);
                    }
                }
            }
        } else {
            db.exec('DELETE FROM vehicles');
            db.exec('DELETE FROM swaps');
            db.exec("DELETE FROM sqlite_sequence WHERE name='vehicles'");
            db.exec("DELETE FROM sqlite_sequence WHERE name='swaps'");
            const vehicleStmt = db.prepare(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, status, maintenance, maintenanceCategory, hasAccident, sascarStatus, keys, notes, entregar_diversos, entregar_correios, entregue, entreguePara, readyTime, entryTime, exitTime, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const v of importedVehicles) {
                if (v.plate || v.chassis) {
                    vehicleStmt.run(v.plate ? v.plate.toUpperCase() : '', v.type, v.yard, v.base || 'Jaraguá-SP (Nacional)', v.baseDestino || '', v.manager || '', v.chassis || '', v.status || 'Aguardando linha', v.maintenance ? 1 : 0, v.maintenanceCategory || '', v.hasAccident ? 1 : 0, v.sascarStatus || 'pendente', v.keys || '', v.notes || '', v.entregarDiversos ? 1 : 0, v.entregarCorreios ? 1 : 0, v.entregue ? 1 : 0, v.entreguePara || '', v.readyTime || null, v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username);
                }
            }
            if (Array.isArray(importedSwaps) && importedSwaps.length > 0) {
                const swapStmt = db.prepare(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                for (const s of importedSwaps) {
                    if (s.plateOut) {
                        swapStmt.run(s.date || new Date().toISOString(), s.plateIn || '0000', s.plateOut, s.base || '', s.baseDestino || '', s.notes || '', s.tipo || 'troca', req.session.user.username);
                    }
                }
            }
        }
        const swapsCount = Array.isArray(importedSwaps) ? importedSwaps.length : 0;
        res.json({ success: true, imported: importedVehicles.length, swapsImported: swapsCount, message: `✅ Importação concluída: ${importedVehicles.length} veículo(s) e ${swapsCount} troca(s)` });
    } catch (err) {
        console.error('❌ Erro ao importar:', err);
        res.status(500).json({ error: 'Erro ao importar: ' + err.message });
    }
});

app.get('/api/export', requireAuth, async (req, res) => {
    try {
        let vehicles, swaps;
        if (isProduction) {
            vehicles = (await pool.query('SELECT * FROM vehicles')).rows;
            swaps = (await pool.query('SELECT * FROM swaps')).rows;
        } else {
            vehicles = db.prepare('SELECT * FROM vehicles').all();
            swaps = db.prepare('SELECT * FROM swaps').all();
        }
        res.json({ vehicles, swaps, exportedAt: new Date().toISOString(), version: '5.9.5', exportedBy: req.session.user.username });
    } catch (err) { res.status(500).json({ error: 'Erro ao exportar' }); }
});

function formatDateBR(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function calculateTimeInYard(entryTime, exitTime) {
    const start = new Date(entryTime);
    const end = exitTime ? new Date(exitTime) : new Date();
    const diffMs = end - start;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}min`;
}

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚚 CONTROLE DE PÁTIO PRINT - v5.9.5');
    console.log('='.repeat(60));
    console.log(`📍 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('👥 USUÁRIOS DISPONÍVEIS:');
    console.log('   👑 admin / Print@2026');
    console.log('   📍 cajamar / Cajamar2026');
    console.log('   📍 bandeirantes / Bandeirantes2026');
    console.log('   📍 jaragua / Jaragua2026');
    console.log('='.repeat(60) + '\n');
});