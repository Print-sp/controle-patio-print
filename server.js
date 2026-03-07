require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🔧 Iniciando servidor com permissões...');

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

// ============ BANCO DE DADOS ============
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('📁 Pasta database criada');
}

const dbPath = path.join(dbDir, 'patio.db');
console.log(`💾 Banco de dados: ${dbPath}`);

const db = new Database(dbPath);

// Criar tabelas
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

console.log('✅ Tabelas criadas com sucesso');

// ============ CRIAR USUÁRIOS PADRÃO ============
function criarUsuariosPadrao() {
    try {
        const adminPassword = process.env.ADMIN_PASSWORD || 'Print@2026';
        const operatorPassword = process.env.OPERATOR_PASSWORD || 'Operador2026';
        
        console.log('🔐 Criando usuários padrão...');
        console.log(`   Admin: admin / ${adminPassword}`);
        console.log(`   Operador: operador / ${operatorPassword}`);

        const existingAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
        const existingOperator = db.prepare('SELECT * FROM users WHERE username = ?').get('operador');

        if (!existingAdmin) {
            const adminHash = bcrypt.hashSync(adminPassword, 10);
            db.prepare('INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)')
                .run('admin', adminHash, 'admin');
            console.log('✅ Usuário admin criado');
        } else {
            console.log('ℹ️ Usuário admin já existe');
        }

        if (!existingOperator) {
            const operatorHash = bcrypt.hashSync(operatorPassword, 10);
            db.prepare('INSERT INTO users (username, passwordHash, role) VALUES (?, ?, ?)')
                .run('operador', operatorHash, 'operator');
            console.log('✅ Usuário operador criado');
        } else {
            console.log('ℹ️ Usuário operador já existe');
        }

    } catch (error) {
        console.error('❌ Erro ao criar usuários:', error.message);
    }
}

criarUsuariosPadrao();

// ============ MIDDLEWARES ============
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'print2026secretkey123456789',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000
    }
}));

// Middleware de autenticação
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Não autenticado', redirect: '/login' });
    }
};

// 🔐 Middleware de verificação de permissão (NOVO)
const requireRole = (allowedRoles) => (req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const userRole = req.session.user.role;
    
    if (!allowedRoles.includes(userRole)) {
        // Log de tentativa de acesso não autorizado
        db.run(`INSERT INTO audit_log (action, entityType, userId, details, timestamp) VALUES (?, ?, ?, ?, ?)`,
            ['ACCESS_DENIED', 'system', req.session.user.id, 
             JSON.stringify({ 
                 role: userRole, 
                 path: req.path, 
                 method: req.method,
                 allowedRoles 
             }), 
             new Date().toISOString()]);
        
        console.log(`🚫 Acesso negado: ${userRole} tentou acessar ${req.path}`);
        
        return res.status(403).json({ 
            error: 'Acesso negado', 
            message: 'Você não tem permissão para realizar esta ação. Contate um administrador.',
            userRole,
            allowedRoles
        });
    }
    
    next();
};

// Middleware de auditoria
const logAction = (action) => (req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (res.statusCode < 400) {
                db.run(`
                    INSERT INTO audit_log (action, entityType, entityId, userId, details, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    action,
                    parsed?.entityType || null,
                    parsed?.entityId || null,
                    req.session?.user?.username || 'system',
                    JSON.stringify({ method: req.method, path: req.path }),
                    new Date().toISOString()
                ]);
            }
        } catch (e) {}
        return originalSend.call(this, data);
    };
    next();
};

// ============ ROTAS DE AUTENTICAÇÃO ============
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log(`🔐 Tentativa de login: ${username}`);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
        
        if (!user) {
            console.log(`❌ Usuário não encontrado: ${username}`);
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }

        console.log(`✅ Usuário encontrado: ${user.username} (role: ${user.role})`);

        const passwordValid = bcrypt.compareSync(password, user.passwordHash);
        
        if (!passwordValid) {
            console.log(`❌ Senha inválida para: ${username}`);
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }

        console.log(`✅ Login bem-sucedido: ${username}`);

        db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

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
    if (req.session?.user) {
        console.log(`🚪 Logout: ${req.session.user.username}`);
        db.run(`INSERT INTO audit_log (action, entityType, userId, details, timestamp) VALUES (?, ?, ?, ?, ?)`,
            ['LOGOUT', 'user', req.session.user.id, req.session.user.username, new Date().toISOString()]);
    }
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

// ============ FUNÇÃO DE PERMISSÕES ============
function getPermissions(role) {
    const permissions = {
        admin: {
            canDelete: true,
            canImport: true,
            canViewAudit: true,
            canManageUsers: true,
            canExport: true,
            canCreate: true,
            canEdit: true,
            canExit: true
        },
        operator: {
            canDelete: false,
            canImport: false,
            canViewAudit: false,
            canManageUsers: false,
            canExport: true,
            canCreate: true,
            canEdit: true,
            canExit: true
        }
    };
    return permissions[role] || permissions.operator;
}

// ============ ROTAS DE VEÍCULOS ============
app.get('/api/vehicles', requireAuth, (req, res) => {
    const vehicles = db.prepare(`
        SELECT * FROM vehicles 
        ORDER BY 
            CASE WHEN status = 'Liberado' THEN 1 ELSE 0 END,
            entryTime DESC
    `).all();

    const vehiclesFormatted = vehicles.map(v => ({
        ...v,
        maintenanceProblems: JSON.parse(v.maintenanceProblems || '[]'),
        entryDate: formatDateBR(v.entryTime),
        exitDate: v.exitTime ? formatDateBR(v.exitTime) : null,
        timeInYard: calculateTimeInYard(v.entryTime, v.exitTime)
    }));

    res.json(vehiclesFormatted);
});

app.post('/api/vehicles', requireAuth, logAction('VEHICLE_CREATED'), (req, res) => {
    const { plate, type, yard, base, keys, notes, entryDate } = req.body;
    
    if (!plate || !type || !yard) {
        return res.status(400).json({ error: 'Placa, tipo e pátio são obrigatórios' });
    }

    const stmt = db.prepare(`
        INSERT INTO vehicles (plate, type, yard, base, keys, notes, entryTime, updatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        plate.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        type,
        yard,
        base || 'Jaraguá-SP',
        keys || '',
        notes || '',
        entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(),
        req.session.user.username
    );

    const newVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);

    res.json({
        ...newVehicle,
        maintenanceProblems: JSON.parse(newVehicle.maintenanceProblems || '[]'),
        entityType: 'vehicle',
        entityId: result.lastInsertRowid
    });
});

app.put('/api/vehicles/:id', requireAuth, logAction('VEHICLE_UPDATED'), (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) {
        return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    const allowedFields = ['plate', 'type', 'yard', 'base', 'status', 'maintenance', 'keys', 'notes', 'entryTime'];
    const setClauses = [];
    const values = [];

    allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
            if (field === 'maintenance') {
                setClauses.push(`${field} = ?`);
                values.push(updates[field] ? 1 : 0);
            } else if (field === 'entryTime') {
                setClauses.push(`${field} = ?`);
                values.push(new Date(updates[field]).toISOString());
            } else {
                setClauses.push(`${field} = ?`);
                values.push(updates[field]);
            }
        }
    });

    setClauses.push(`updatedAt = ?`);
    values.push(new Date().toISOString());
    setClauses.push(`updatedBy = ?`);
    values.push(req.session.user.username);
    values.push(id);

    const stmt = db.prepare(`UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const updatedVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);

    res.json({
        success: true,
        ...updatedVehicle,
        maintenanceProblems: JSON.parse(updatedVehicle.maintenanceProblems || '[]'),
        entityType: 'vehicle',
        entityId: parseInt(id)
    });
});

app.put('/api/vehicles/:id/status', requireAuth, logAction('VEHICLE_STATUS_UPDATED'), (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) {
        return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    const maintenance = status === 'Em manutenção' ? 1 : vehicle.maintenance;

    db.prepare(`
        UPDATE vehicles SET status = ?, maintenance = ?, updatedAt = ?, updatedBy = ?
        WHERE id = ?
    `).run(status, maintenance, new Date().toISOString(), req.session.user.username, id);

    const updatedVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);

    res.json({
        success: true,
        ...updatedVehicle,
        maintenanceProblems: JSON.parse(updatedVehicle.maintenanceProblems || '[]'),
        entityType: 'vehicle',
        entityId: parseInt(id)
    });
});

app.post('/api/vehicles/:id/exit', requireAuth, logAction('VEHICLE_EXIT'), (req, res) => {
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) {
        return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    db.prepare(`
        UPDATE vehicles SET status = 'Liberado', exitTime = ?, updatedAt = ?, updatedBy = ?
        WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), req.session.user.username, id);

    const updatedVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);

    res.json({
        success: true,
        ...updatedVehicle,
        maintenanceProblems: JSON.parse(updatedVehicle.maintenanceProblems || '[]'),
        entityType: 'vehicle',
        entityId: parseInt(id)
    });
});

// 🔐 Rota de EXCLUIR - Apenas ADMIN
app.delete('/api/vehicles/:id', requireAuth, requireRole(['admin']), logAction('VEHICLE_DELETED'), (req, res) => {
    const { id } = req.params;

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) {
        return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);

    res.json({
        success: true,
        message: 'Veículo removido',
        entityType: 'vehicle',
        entityId: parseInt(id)
    });
});

// ============ ROTAS DE TROCAS ============
app.get('/api/swaps', requireAuth, (req, res) => {
    const swaps = db.prepare('SELECT * FROM swaps ORDER BY createdAt DESC LIMIT 100').all();
    
    const swapsFormatted = swaps.map(s => ({
        ...s,
        dateFormatted: formatDateBR(s.date)
    }));

    res.json(swapsFormatted);
});

app.post('/api/swaps', requireAuth, logAction('SWAP_CREATED'), (req, res) => {
    const { dateIn, plateIn, plateOut, base, notes } = req.body;
    
    const stmt = db.prepare(`
        INSERT INTO swaps (date, plateIn, plateOut, base, notes, updatedBy)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        dateIn ? new Date(dateIn).toISOString() : new Date().toISOString(),
        plateIn?.toUpperCase() || '0000',
        plateOut?.toUpperCase() || '0000',
        base || '',
        notes || '',
        req.session.user.username
    );

    const newSwap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(result.lastInsertRowid);

    res.json({
        success: true,
        ...newSwap,
        dateFormatted: formatDateBR(newSwap.date),
        entityType: 'swap',
        entityId: result.lastInsertRowid
    });
});

app.put('/api/swaps/:id', requireAuth, logAction('SWAP_UPDATED'), (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(id);
    if (!swap) {
        return res.status(404).json({ error: 'Troca não encontrada' });
    }

    const allowedFields = ['date', 'plateIn', 'plateOut', 'base', 'notes'];
    const setClauses = [];
    const values = [];

    allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
            if (field === 'date') {
                setClauses.push(`${field} = ?`);
                values.push(new Date(updates[field]).toISOString());
            } else {
                setClauses.push(`${field} = ?`);
                values.push(updates[field]);
            }
        }
    });

    values.push(id);
    const stmt = db.prepare(`UPDATE swaps SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const updatedSwap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(id);

    res.json({
        success: true,
        ...updatedSwap,
        dateFormatted: formatDateBR(updatedSwap.date),
        entityType: 'swap',
        entityId: parseInt(id)
    });
});

// 🔐 Rota de EXCLUIR TROCA - Apenas ADMIN
app.delete('/api/swaps/:id', requireAuth, requireRole(['admin']), logAction('SWAP_DELETED'), (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM swaps WHERE id = ?').run(id);

    res.json({
        success: true,
        entityType: 'swap',
        entityId: parseInt(id)
    });
});

// ============ ESTATÍSTICAS ============
app.get('/api/stats', requireAuth, (req, res) => {
    const active = db.prepare("SELECT * FROM vehicles WHERE status != 'Liberado'").all();
    const liberated = db.prepare("SELECT * FROM vehicles WHERE status = 'Liberado'").all();

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

    const stats = {
        cavalosMecanicos: active.filter(v => v.type === 'Cavalo Mecânico').length,
        carretas: active.filter(v => v.type === 'Carreta').length,
        emManutencao: active.filter(v => v.status === 'Em manutenção').length,
        liberados: liberated.length,
        entreguesDiversos,
        entreguesCorreios,
        totalAtivos: active.length,
        totalGeral: db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count,
        stalledVehicles: stalledVehicles.length,
        stalledVehiclesList: stalledVehicles.map(v => ({ id: v.id, plate: v.plate, hours: Math.round((now - new Date(v.entryTime)) / (1000 * 60 * 60)) })),
        lastUpdated: new Date().toISOString()
    };

    res.json(stats);
});

// 🔐 Rota de AUDITORIA - Apenas ADMIN
app.get('/api/audit', requireAuth, requireRole(['admin']), (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    const logs = db.prepare(`
        SELECT * FROM audit_log 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset));

    res.json(logs);
});

// ============ IMPORTAR/EXPORTAR ============
// 🔐 IMPORTAR - Apenas ADMIN
app.post('/api/import', requireAuth, requireRole(['admin']), logAction('DATA_IMPORTED'), (req, res) => {
    const { vehicles: importedVehicles, swaps: importedSwaps } = req.body;
    
    if (!Array.isArray(importedVehicles)) {
        return res.status(400).json({ error: 'Dados devem conter: {"vehicles": [...]} ' });
    }

    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const backup = {
        vehicles: db.prepare('SELECT * FROM vehicles').all(),
        swaps: db.prepare('SELECT * FROM swaps').all(),
        exportedAt: new Date().toISOString(),
        backedUpBy: req.session.user.username
    };
    
    const backupFile = path.join(backupDir, `backup-pre-import-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`💾 Backup criado antes da importação: ${backupFile}`);

    db.exec('DELETE FROM vehicles');
    db.exec('DELETE FROM swaps');
    db.exec("DELETE FROM sqlite_sequence WHERE name='vehicles'");
    db.exec("DELETE FROM sqlite_sequence WHERE name='swaps'");

    let imported = 0;
    let errors = 0;

    const vehicleStmt = db.prepare(`
        INSERT INTO vehicles (plate, type, yard, base, status, maintenance, keys, notes, entryTime, exitTime, updatedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    importedVehicles.forEach(v => {
        if (v.plate && v.type && v.yard) {
            try {
                vehicleStmt.run(
                    v.plate.toUpperCase(),
                    v.type,
                    v.yard,
                    v.base || 'Jaraguá-SP',
                    v.status || 'Aguardando linha',
                    v.maintenance ? 1 : 0,
                    v.keys || '',
                    v.notes || '',
                    v.entryTime || new Date().toISOString(),
                    v.exitTime || null,
                    req.session.user.username
                );
                imported++;
            } catch (e) {
                errors++;
            }
        } else {
            errors++;
        }
    });

    if (Array.isArray(importedSwaps)) {
        const swapStmt = db.prepare(`
            INSERT INTO swaps (date, plateIn, plateOut, base, notes, updatedBy)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        importedSwaps.forEach(s => {
            if (s.plateOut) {
                try {
                    swapStmt.run(
                        s.date || new Date().toISOString(),
                        s.plateIn || '0000',
                        s.plateOut,
                        s.base || '',
                        s.notes || '',
                        req.session.user.username
                    );
                } catch (e) {}
            }
        });
    }

    res.json({ 
        success: true, 
        imported, 
        errors, 
        message: `✅ ${imported} veículo(s) importado(s).`,
        entityType: 'system',
        entityId: 0
    });
});

// ✅ EXPORTAR - Admin e Operador podem
app.get('/api/export', requireAuth, (req, res) => {
    const data = {
        vehicles: db.prepare('SELECT * FROM vehicles').all(),
        swaps: db.prepare('SELECT * FROM swaps').all(),
        exportedAt: new Date().toISOString(),
        version: '4.0',
        exportedBy: req.session.user.username
    };
    res.json(data);
});

// ============ FUNÇÕES AUXILIARES ============
function formatDateBR(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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
    console.log('🚚 CONTROLE DE PÁTIO PRINT - v4.0 (COM PERMISSÕES)');
    console.log('='.repeat(60));
    console.log(`📍 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('🔐 CREDENCIAIS DE ACESSO:');
    console.log(`   👑 Admin:    admin    / ${process.env.ADMIN_PASSWORD || 'Print@2026'}`);
    console.log(`   👤 Operador: operador / ${process.env.OPERATOR_PASSWORD || 'Operador2026'}`);
    console.log('='.repeat(60));
    console.log('🔒 PERMISSÕES:');
    console.log('   Admin:    Acesso TOTAL (criar, editar, excluir, importar, auditoria)');
    console.log('   Operador: Acesso LIMITADO (criar, editar, NÃO pode excluir/importar)');
    console.log('='.repeat(60));
    console.log('💾 Banco de dados: ' + dbPath);
    console.log('='.repeat(60) + '\n');
});