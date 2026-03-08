require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Detectar ambiente: Produção = PostgreSQL, Local = SQLite
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

// 🔧 Trust proxy para Render
app.set('trust proxy', 1);

console.log('🔧 Iniciando servidor...');
console.log(`🌐 Ambiente: ${isProduction ? 'Produção' : 'Desenvolvimento'}`);

// ============ SEGURANÇA ============
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: true,
    credentials: true
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// ============ MAPEAMENTO POSTGRESQL → CAMELCASE ============
function mapPostgresRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        plate: row.plate,
        type: row.type,
        yard: row.yard,
        base: row.base,
        status: row.status,
        maintenance: row.maintenance,
        maintenanceProblems: row.maintenanceproblems || [],
        keys: row.keys,
        notes: row.notes,
        deliveryCategory: row.deliverycategory || '',
        entryTime: row.entrytime,
        exitTime: row.exittime,
        icon: row.icon,
        createdAt: row.createdat,
        updatedAt: row.updatedat,
        updatedBy: row.updatedby
    };
}

function mapUserRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        passwordHash: row.passwordhash || row.password_hash,
        role: row.role,
        createdAt: row.createdat,
        lastLogin: row.lastlogin
    };
}

function mapSwapRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        date: row.date,
        plateIn: row.platein,
        plateOut: row.plateout,
        base: row.base,
        notes: row.notes,
        createdAt: row.createdat,
        updatedBy: row.updatedby
    };
}

// ============ INICIALIZAR BANCO ============
async function initDatabase() {
    if (isProduction) {
        try {
            // Criar tabela vehicles com deliveryCategory
            await pool.query(`
                CREATE TABLE IF NOT EXISTS vehicles (
                    id SERIAL PRIMARY KEY,
                    plate TEXT NOT NULL,
                    type TEXT NOT NULL,
                    yard TEXT NOT NULL,
                    base TEXT DEFAULT 'Jaraguá-SP',
                    status TEXT DEFAULT 'Aguardando linha',
                    maintenance BOOLEAN DEFAULT false,
                    maintenanceProblems JSONB DEFAULT '[]',
                    keys TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    deliveryCategory TEXT DEFAULT '',
                    entryTime TIMESTAMP NOT NULL,
                    exitTime TIMESTAMP,
                    icon TEXT DEFAULT 'default-truck',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                
                CREATE TABLE IF NOT EXISTS swaps (
                    id SERIAL PRIMARY KEY,
                    date TIMESTAMP NOT NULL,
                    plateIn TEXT DEFAULT '0000',
                    plateOut TEXT NOT NULL,
                    base TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    passwordHash TEXT NOT NULL,
                    role TEXT DEFAULT 'operator',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    lastLogin TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS audit_log (
                    id SERIAL PRIMARY KEY,
                    action TEXT NOT NULL,
                    entityType TEXT,
                    entityId INTEGER,
                    userId TEXT,
                    details JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
                CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
                CREATE INDEX IF NOT EXISTS idx_vehicles_yard ON vehicles(yard);
            `);
            
            // Migração: adicionar deliveryCategory se não existir
            await pool.query(`
                ALTER TABLE vehicles 
                ADD COLUMN IF NOT EXISTS "deliveryCategory" TEXT DEFAULT ''
            `);
            
            // Criar usuários padrão se não existirem
            const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
            if (adminExists.rows.length === 0) {
                const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Print@2026', 10);
                const operatorHash = bcrypt.hashSync(process.env.OPERATOR_PASSWORD || 'Operador2026', 10);
                await pool.query('INSERT INTO users (username, passwordHash, role) VALUES ($1, $2, $3)', ['admin', adminHash, 'admin']);
                await pool.query('INSERT INTO users (username, passwordHash, role) VALUES ($1, $2, $3)', ['operador', operatorHash, 'operator']);
                console.log('✅ Usuários padrão criados (PostgreSQL)');
            }
            console.log('✅ PostgreSQL inicializado');
        } catch (err) {
            console.error('❌ Erro PostgreSQL:', err.message);
        }
    } else {
        try {
            // SQLite
            db.exec(`
                CREATE TABLE IF NOT EXISTS vehicles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plate TEXT NOT NULL,
                    type TEXT NOT NULL,
                    yard TEXT NOT NULL,
                    base TEXT DEFAULT 'Jaraguá-SP',
                    status TEXT DEFAULT 'Aguardando linha',
                    maintenance INTEGER DEFAULT 0,
                    maintenanceProblems TEXT DEFAULT '[]',
                    keys TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    deliveryCategory TEXT DEFAULT '',
                    entryTime TEXT NOT NULL,
                    exitTime TEXT,
                    icon TEXT DEFAULT 'default-truck',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                
                CREATE TABLE IF NOT EXISTS swaps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    plateIn TEXT DEFAULT '0000',
                    plateOut TEXT NOT NULL,
                    base TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    passwordHash TEXT NOT NULL,
                    role TEXT DEFAULT 'operator',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    lastLogin TEXT
                );
                
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    entityType TEXT,
                    entityId INTEGER,
                    userId TEXT,
                    details TEXT,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
                );
            `);
            
            // Criar usuários padrão se não existirem
            const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
            if (!adminExists) {
                const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Print@2026', 10);
                const operatorHash = bcrypt.hashSync(process.env.OPERATOR_PASSWORD || 'Operador2026', 10);
                db.prepare('INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'admin');
                db.prepare('INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)').run('operador', operatorHash, 'operator');
                console.log('✅ Usuários padrão criados (SQLite)');
            }
            console.log('✅ SQLite inicializado');
        } catch (err) {
            console.error('❌ Erro SQLite:', err.message);
        }
    }
}

initDatabase();

// ============ MIDDLEWARES ============
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'print2026secretkey123456789',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Não autenticado' });
    }
};

const requireRole = (allowedRoles) => (req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!allowedRoles.includes(req.session.user.role)) {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
};

// ============ AUTENTICAÇÃO ============
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    }

    try {
        let user;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
            user = mapUserRow(result.rows[0]);
        } else {
            user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }

        const passwordValid = bcrypt.compareSync(password, user.passwordHash);
        
        if (!passwordValid) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }

        req.session.user = { id: user.id, username: user.username, role: user.role };

        res.json({ 
            success: true, 
            user: { username: user.username, role: user.role },
            message: `Bem-vindo, ${user.username}!`
        });

    } catch (error) {
        console.error('❌ Erro no login:', error.message);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session?.user) {
        res.json({ 
            authenticated: true, 
            user: req.session.user,
            permissions: getPermissions(req.session.user.role)
        });
    } else {
        res.json({ authenticated: false });
    }
});

function getPermissions(role) {
    return {
        admin: { canDelete: true, canImport: true, canExport: true, canCreate: true, canEdit: true, canExit: true },
        operator: { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true }
    }[role] || { canDelete: false, canImport: false, canExport: true, canCreate: true, canEdit: true, canExit: true };
}

// ============ VEÍCULOS ============
app.get('/api/vehicles', requireAuth, async (req, res) => {
    try {
        let vehicles;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM vehicles ORDER BY entryTime DESC');
            vehicles = result.rows.map(mapPostgresRow);
        } else {
            vehicles = db.prepare('SELECT * FROM vehicles ORDER BY entryTime DESC').all();
            vehicles = vehicles.map(v => ({ ...v, maintenanceProblems: JSON.parse(v.maintenanceProblems || '[]') }));
        }
        
        res.json(vehicles.map(v => ({
            ...v,
            entryDate: formatDateBR(v.entryTime),
            exitDate: v.exitTime ? formatDateBR(v.exitTime) : null,
            timeInYard: calculateTimeInYard(v.entryTime, v.exitTime)
        })));
    } catch (err) {
        console.error('Erro ao listar veículos:', err);
        res.status(500).json({ error: 'Erro ao buscar veículos' });
    }
});

app.post('/api/vehicles', requireAuth, async (req, res) => {
    const { plate, type, yard, base, keys, notes, entryDate, deliveryCategory } = req.body;
    
    if (!plate || !type || !yard) {
        return res.status(400).json({ error: 'Placa, tipo e pátio obrigatórios' });
    }

    try {
        if (isProduction) {
            const result = await pool.query(`
                INSERT INTO vehicles (plate, type, yard, base, keys, notes, deliveryCategory, entryTime, updatedBy)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
            `, [
                plate.toUpperCase(), 
                type, 
                yard, 
                base || 'Jaraguá-SP', 
                keys || '', 
                notes || '', 
                deliveryCategory || '', 
                entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), 
                req.session.user.username
            ]);
            res.json(mapPostgresRow(result.rows[0]));
        } else {
            const stmt = db.prepare(`
                INSERT INTO vehicles (plate, type, yard, base, keys, notes, deliveryCategory, entryTime, updatedBy)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(
                plate.toUpperCase(), 
                type, 
                yard, 
                base || 'Jaraguá-SP', 
                keys || '', 
                notes || '',
                deliveryCategory || '', 
                entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), 
                req.session.user.username
            );
            const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
            res.json({ ...vehicle, maintenanceProblems: JSON.parse(vehicle.maintenanceProblems || '[]') });
        }
    } catch (err) {
        console.error('Erro ao criar veículo:', err);
        res.status(500).json({ error: 'Erro ao criar veículo' });
    }
});

// 🔧 CORREÇÃO DATA RETROATIVA - PUT agora aceita e salva entryTime
app.put('/api/vehicles/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    console.log('🔧 Atualizando veículo:', id);
    console.log('📅 EntryTime recebido:', updates.entryTime);
    
    try {
        if (isProduction) {
            await pool.query(`
                UPDATE vehicles SET 
                    plate = COALESCE($1, plate), 
                    type = COALESCE($2, type),
                    yard = COALESCE($3, yard), 
                    base = COALESCE($4, base),
                    status = COALESCE($5, status),
                    maintenance = COALESCE($6, maintenance), 
                    notes = COALESCE($7, notes),
                    deliveryCategory = COALESCE($8, deliveryCategory),
                    entryTime = COALESCE($9, entryTime),
                    updatedAt = CURRENT_TIMESTAMP, 
                    updatedBy = $10
                WHERE id = $11
            `, [
                updates.plate, 
                updates.type, 
                updates.yard, 
                updates.base,
                updates.status, 
                updates.maintenance, 
                updates.notes,
                updates.deliveryCategory || '',
                updates.entryTime,  // ← DATA RETROATIVA SALVA AQUI
                req.session.user.username, 
                id
            ]);
        } else {
            db.prepare(`
                UPDATE vehicles SET 
                    plate = ?, type = ?, yard = ?, base = ?, 
                    status = ?, maintenance = ?, notes = ?,
                    deliveryCategory = ?,
                    entryTime = ?,
                    updatedAt = ?, updatedBy = ?
                WHERE id = ?
            `).run(
                updates.plate, 
                updates.type, 
                updates.yard, 
                updates.base,
                updates.status, 
                updates.maintenance, 
                updates.notes,
                updates.deliveryCategory || '',
                updates.entryTime,  // ← DATA RETROATIVA SALVA AQUI
                new Date().toISOString(), 
                req.session.user.username, 
                id
            );
        }
        
        console.log('✅ Veículo atualizado com sucesso');
        res.json({ success: true, message: 'Veículo atualizado com sucesso' });
    } catch (err) {
        console.error('❌ Erro ao atualizar:', err);
        res.status(500).json({ error: 'Erro ao atualizar veículo: ' + err.message });
    }
});

app.put('/api/vehicles/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = $1, maintenance = $2, updatedAt = CURRENT_TIMESTAMP WHERE id = $3`,
                [status, status === 'Em manutenção', id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = ?, maintenance = ?, updatedAt = ? WHERE id = ?`)
                .run(status, status === 'Em manutenção' ? 1 : 0, new Date().toISOString(), id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

app.post('/api/vehicles/:id/exit', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = 'Liberado', exitTime = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = 'Liberado', exitTime = ? WHERE id = ?`)
                .run(new Date().toISOString(), id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao registrar saída' });
    }
});

app.delete('/api/vehicles/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            await pool.query('DELETE FROM vehicles WHERE id = $1', [id]);
        } else {
            db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar' });
    }
});

// ============ TROCAS ============
app.get('/api/swaps', requireAuth, async (req, res) => {
    try {
        let swaps;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM swaps ORDER BY createdAt DESC LIMIT 100');
            swaps = result.rows.map(mapSwapRow);
        } else {
            swaps = db.prepare('SELECT * FROM swaps ORDER BY createdAt DESC LIMIT 100').all();
        }
        res.json(swaps.map(s => ({ ...s, dateFormatted: formatDateBR(s.date) })));
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar trocas' });
    }
});

app.post('/api/swaps', requireAuth, async (req, res) => {
    const { dateIn, plateIn, plateOut, base, notes } = req.body;
    try {
        if (isProduction) {
            const result = await pool.query(`
                INSERT INTO swaps (date, plateIn, plateOut, base, notes, updatedBy)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
            `, [
                dateIn ? new Date(dateIn).toISOString() : new Date().toISOString(),
                plateIn?.toUpperCase() || '0000', 
                plateOut?.toUpperCase() || '0000',
                base || '', 
                notes || '', 
                req.session.user.username
            ]);
            res.json({ success: true, ...mapSwapRow(result.rows[0]), dateFormatted: formatDateBR(result.rows[0].date) });
        } else {
            const stmt = db.prepare(`INSERT INTO swaps (date, plateIn, plateOut, base, notes, updatedBy) VALUES (?, ?, ?, ?, ?, ?)`);
            const result = stmt.run(
                dateIn ? new Date(dateIn).toISOString() : new Date().toISOString(),
                plateIn?.toUpperCase() || '0000', 
                plateOut?.toUpperCase() || '0000', 
                base || '', 
                notes || '', 
                req.session.user.username
            );
            const swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(result.lastInsertRowid);
            res.json({ success: true, ...swap, dateFormatted: formatDateBR(swap.date) });
        }
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar troca' });
    }
});

app.put('/api/swaps/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        if (isProduction) {
            await pool.query(`UPDATE swaps SET date = COALESCE($1, date), plateIn = COALESCE($2, plateIn),
                plateOut = COALESCE($3, plateOut), base = COALESCE($4, base), notes = COALESCE($5, notes)
                WHERE id = $6`, [
                updates.date ? new Date(updates.date).toISOString() : null,
                updates.plateIn, 
                updates.plateOut, 
                updates.base, 
                updates.notes, 
                id
            ]);
        } else {
            db.prepare(`UPDATE swaps SET date = ?, plateIn = ?, plateOut = ?, base = ?, notes = ? WHERE id = ?`)
                .run(
                    updates.date ? new Date(updates.date).toISOString() : null, 
                    updates.plateIn, 
                    updates.plateOut, 
                    updates.base, 
                    updates.notes, 
                    id
                );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar' });
    }
});

app.delete('/api/swaps/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            await pool.query('DELETE FROM swaps WHERE id = $1', [id]);
        } else {
            db.prepare('DELETE FROM swaps WHERE id = ?').run(id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar' });
    }
});

// ============ ESTATÍSTICAS ============
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        let active, liberated;
        if (isProduction) {
            const activeRes = await pool.query("SELECT * FROM vehicles WHERE status != 'Liberado'");
            const liberatedRes = await pool.query("SELECT * FROM vehicles WHERE status = 'Liberado'");
            active = activeRes.rows.map(mapPostgresRow);
            liberated = liberatedRes.rows.map(mapPostgresRow);
        } else {
            active = db.prepare("SELECT * FROM vehicles WHERE status != 'Liberado'").all();
            liberated = db.prepare("SELECT * FROM vehicles WHERE status = 'Liberado'").all();
            active = active.map(v => ({ ...v, maintenanceProblems: JSON.parse(v.maintenanceProblems || '[]') }));
            liberated = liberated.map(v => ({ ...v, maintenanceProblems: JSON.parse(v.maintenanceProblems || '[]') }));
        }

        const entreguesDiversos = liberated.filter(v => {
            const notes = (v.notes || '').toLowerCase();
            return !notes.includes('correios') && !notes.includes('ect');
        }).length;

        const entreguesCorreios = liberated.filter(v => {
            const notes = (v.notes || '').toLowerCase();
            return notes.includes('correios') || notes.includes('ect');
        }).length;

        const now = new Date();
        const stalledVehicles = active.filter(v => {
            const entry = new Date(v.entryTime);
            const hoursDiff = (now - entry) / (1000 * 60 * 60);
            return hoursDiff > 24 && v.status === 'Aguardando linha';
        });

        res.json({
            cavalosMecanicos: active.filter(v => v.type === 'Cavalo Mecânico').length,
            carretas: active.filter(v => v.type === 'Carreta').length,
            emManutencao: active.filter(v => v.status === 'Em manutenção').length,
            liberados: liberated.length,
            entreguesDiversos,
            entreguesCorreios,
            totalAtivos: active.length,
            totalGeral: active.length + liberated.length,
            stalledVehicles: stalledVehicles.length,
            stalledVehiclesList: stalledVehicles.map(v => ({ 
                id: v.id, plate: v.plate, 
                hours: Math.round((now - new Date(v.entryTime)) / (1000 * 60 * 60)) 
            })),
            lastUpdated: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// ============ IMPORTAR/EXPORTAR ============
app.post('/api/import', requireAuth, requireRole(['admin']), async (req, res) => {
    const { vehicles: importedVehicles, swaps: importedSwaps } = req.body;
    
    if (!Array.isArray(importedVehicles)) {
        return res.status(400).json({ error: 'Dados devem conter: {"vehicles": [...]} ' });
    }

    try {
        if (isProduction) {
            await pool.query('DELETE FROM vehicles');
            await pool.query('DELETE FROM swaps');
            
            for (const v of importedVehicles) {
                if (v.plate && v.type && v.yard) {
                    await pool.query(`INSERT INTO vehicles (plate, type, yard, base, status, maintenance, keys, notes, deliveryCategory, entryTime, exitTime, updatedBy)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
                        v.plate.toUpperCase(), v.type, v.yard, v.base || 'Jaraguá-SP',
                        v.status || 'Aguardando linha', v.maintenance || false, v.keys || '', v.notes || '',
                        v.deliveryCategory || '', v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username
                    ]);
                }
            }
        } else {
            db.exec('DELETE FROM vehicles');
            db.exec('DELETE FROM swaps');
            db.exec("DELETE FROM sqlite_sequence WHERE name='vehicles'");
            db.exec("DELETE FROM sqlite_sequence WHERE name='swaps'");
            
            const vehicleStmt = db.prepare(`INSERT INTO vehicles (plate, type, yard, base, status, maintenance, keys, notes, deliveryCategory, entryTime, exitTime, updatedBy)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const v of importedVehicles) {
                if (v.plate && v.type && v.yard) {
                    vehicleStmt.run(
                        v.plate.toUpperCase(), v.type, v.yard, v.base || 'Jaraguá-SP',
                        v.status || 'Aguardando linha', v.maintenance ? 1 : 0, v.keys || '', v.notes || '',
                        v.deliveryCategory || '', v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username
                    );
                }
            }
        }
        
        res.json({ success: true, imported: importedVehicles.length, message: '✅ Importação concluída' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao importar' });
    }
});

app.get('/api/export', requireAuth, async (req, res) => {
    try {
        let vehicles, swaps;
        if (isProduction) {
            const vRes = await pool.query('SELECT * FROM vehicles');
            const sRes = await pool.query('SELECT * FROM swaps');
            vehicles = vRes.rows;
            swaps = sRes.rows;
        } else {
            vehicles = db.prepare('SELECT * FROM vehicles').all();
            swaps = db.prepare('SELECT * FROM swaps').all();
        }
        res.json({ vehicles, swaps, exportedAt: new Date().toISOString(), version: '5.3', exportedBy: req.session.user.username });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao exportar' });
    }
});

// ============ FUNÇÕES AUXILIARES ============
function formatDateBR(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    const options = {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    };
    return date.toLocaleDateString('pt-BR', options);
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

// ============ INICIAR SERVIDOR ============
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚚 CONTROLE DE PÁTIO PRINT - v5.3');
    console.log('='.repeat(60));
    console.log(`📍 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('🔐 Sistema iniciado. Consulte o administrador para credenciais.');
    console.log('='.repeat(60));
    console.log(`💾 Banco: ${isProduction ? 'PostgreSQL' : 'SQLite'}`);
    console.log('🕐 Fuso: America/Sao_Paulo (UTC-3)');
    console.log('='.repeat(60) + '\n');
});