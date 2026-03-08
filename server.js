require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🔧 Iniciando servidor com PostgreSQL...');

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

// ============ CONEXÃO POSTGRESQL ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Testar conexão
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar PostgreSQL:', err.message);
  } else {
    console.log('✅ PostgreSQL conectado com sucesso!');
    release();
  }
});

// ============ INICIALIZAR BANCO ============
async function initDatabase() {
  try {
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
    
    // Criar usuários padrão se não existirem
    const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
      const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Print@2026', 10);
      const operatorHash = bcrypt.hashSync(process.env.OPERATOR_PASSWORD || 'Operador2026', 10);
      await pool.query('INSERT INTO users (username, passwordHash, role) VALUES ($1, $2, $3)', ['admin', adminHash, 'admin']);
      await pool.query('INSERT INTO users (username, passwordHash, role) VALUES ($1, $2, $3)', ['operador', operatorHash, 'operator']);
      console.log('✅ Usuários padrão criados');
    }
    
    console.log('✅ Banco de dados PostgreSQL inicializado');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err.message);
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
        secure: process.env.NODE_ENV === 'production',
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

// Middleware de verificação de permissão
const requireRole = (allowedRoles) => (req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const userRole = req.session.user.role;
    
    if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ 
            error: 'Acesso negado', 
            message: 'Você não tem permissão para realizar esta ação.'
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
                pool.query(`
                    INSERT INTO audit_log (action, entityType, entityId, userId, details, timestamp)
                    VALUES ($1, $2, $3, $4, $5, $6)
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
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    console.log(`🔐 Tentativa de login: ${username}`);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
        const user = result.rows[0];
        
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

        await pool.query('UPDATE users SET lastLogin = $1 WHERE id = $2', [new Date().toISOString(), user.id]);

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
app.get('/api/vehicles', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM vehicles 
            ORDER BY 
                CASE WHEN status = 'Liberado' THEN 1 ELSE 0 END,
                entryTime DESC
        `);
        
        const vehiclesFormatted = result.rows.map(v => ({
            ...v,
            maintenanceProblems: v.maintenanceproblems || [],
            entryDate: formatDateBR(v.entrytime),
            exitDate: v.exittime ? formatDateBR(v.exittime) : null,
            timeInYard: calculateTimeInYard(v.entrytime, v.exittime)
        }));

        res.json(vehiclesFormatted);
    } catch (err) {
        console.error('Erro ao listar veículos:', err);
        res.status(500).json({ error: 'Erro ao buscar veículos' });
    }
});

app.post('/api/vehicles', requireAuth, logAction('VEHICLE_CREATED'), async (req, res) => {
    const { plate, type, yard, base, keys, notes, entryDate } = req.body;
    
    if (!plate || !type || !yard) {
        return res.status(400).json({ error: 'Placa, tipo e pátio são obrigatórios' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO vehicles (plate, type, yard, base, keys, notes, entrytime, updatedby)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            plate.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
            type,
            yard,
            base || 'Jaraguá-SP',
            keys || '',
            notes || '',
            entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(),
            req.session.user.username
        ]);
        
        const newVehicle = result.rows[0];
        newVehicle.maintenanceProblems = newVehicle.maintenanceproblems || [];

        res.json({
            ...newVehicle,
            entityType: 'vehicle',
            entityId: newVehicle.id
        });
    } catch (err) {
        console.error('Erro ao criar veículo:', err);
        res.status(500).json({ error: 'Erro ao criar veículo' });
    }
});

app.put('/api/vehicles/:id', requireAuth, logAction('VEHICLE_UPDATED'), async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE vehicles 
            SET plate = COALESCE($1, plate),
                type = COALESCE($2, type),
                yard = COALESCE($3, yard),
                base = COALESCE($4, base),
                status = COALESCE($5, status),
                maintenance = COALESCE($6, maintenance),
                keys = COALESCE($7, keys),
                notes = COALESCE($8, notes),
                entrytime = COALESCE($9, entrytime),
                updatedat = CURRENT_TIMESTAMP,
                updatedby = $10
            WHERE id = $11
            RETURNING *
        `, [
            updates.plate,
            updates.type,
            updates.yard,
            updates.base,
            updates.status,
            updates.maintenance,
            updates.keys,
            updates.notes,
            updates.entryTime ? new Date(updates.entryTime).toISOString() : null,
            req.session.user.username,
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado' });
        }
        
        const updatedVehicle = result.rows[0];
        updatedVehicle.maintenanceProblems = updatedVehicle.maintenanceproblems || [];

        res.json({
            success: true,
            ...updatedVehicle,
            entityType: 'vehicle',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro ao atualizar veículo:', err);
        res.status(500).json({ error: 'Erro ao atualizar veículo' });
    }
});

app.put('/api/vehicles/:id/status', requireAuth, logAction('VEHICLE_STATUS_UPDATED'), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        const maintenance = status === 'Em manutenção';
        
        const result = await pool.query(`
            UPDATE vehicles 
            SET status = $1, maintenance = $2, updatedat = CURRENT_TIMESTAMP, updatedby = $3
            WHERE id = $4
            RETURNING *
        `, [status, maintenance, req.session.user.username, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado' });
        }
        
        const updatedVehicle = result.rows[0];
        updatedVehicle.maintenanceProblems = updatedVehicle.maintenanceproblems || [];

        res.json({
            success: true,
            ...updatedVehicle,
            entityType: 'vehicle',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro ao atualizar status:', err);
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

app.post('/api/vehicles/:id/exit', requireAuth, logAction('VEHICLE_EXIT'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`
            UPDATE vehicles 
            SET status = 'Liberado', exittime = CURRENT_TIMESTAMP, 
                updatedat = CURRENT_TIMESTAMP, updatedby = $1
            WHERE id = $2
            RETURNING *
        `, [req.session.user.username, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado' });
        }
        
        const updatedVehicle = result.rows[0];
        updatedVehicle.maintenanceProblems = updatedVehicle.maintenanceproblems || [];

        res.json({
            success: true,
            ...updatedVehicle,
            entityType: 'vehicle',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro na saída:', err);
        res.status(500).json({ error: 'Erro ao registrar saída' });
    }
});

app.delete('/api/vehicles/:id', requireAuth, requireRole(['admin']), logAction('VEHICLE_DELETED'), async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query('DELETE FROM vehicles WHERE id = $1', [id]);
        res.json({
            success: true,
            message: 'Veículo removido',
            entityType: 'vehicle',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro ao deletar:', err);
        res.status(500).json({ error: 'Erro ao deletar veículo' });
    }
});

// ============ ROTAS DE TROCAS ============
app.get('/api/swaps', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM swaps ORDER BY createdat DESC LIMIT 100');
        
        const swapsFormatted = result.rows.map(s => ({
            ...s,
            dateFormatted: formatDateBR(s.date)
        }));

        res.json(swapsFormatted);
    } catch (err) {
        console.error('Erro ao listar trocas:', err);
        res.status(500).json({ error: 'Erro ao buscar trocas' });
    }
});

app.post('/api/swaps', requireAuth, logAction('SWAP_CREATED'), async (req, res) => {
    const { dateIn, plateIn, plateOut, base, notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO swaps (date, platein, plateout, base, notes, updatedby)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            dateIn ? new Date(dateIn).toISOString() : new Date().toISOString(),
            plateIn?.toUpperCase() || '0000',
            plateOut?.toUpperCase() || '0000',
            base || '',
            notes || '',
            req.session.user.username
        ]);
        
        const newSwap = result.rows[0];

        res.json({
            success: true,
            ...newSwap,
            dateFormatted: formatDateBR(newSwap.date),
            entityType: 'swap',
            entityId: newSwap.id
        });
    } catch (err) {
        console.error('Erro ao criar troca:', err);
        res.status(500).json({ error: 'Erro ao criar troca' });
    }
});

app.put('/api/swaps/:id', requireAuth, logAction('SWAP_UPDATED'), async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        const result = await pool.query(`
            UPDATE swaps 
            SET date = COALESCE($1, date),
                platein = COALESCE($2, platein),
                plateout = COALESCE($3, plateout),
                base = COALESCE($4, base),
                notes = COALESCE($5, notes),
                updatedby = $6
            WHERE id = $7
            RETURNING *
        `, [
            updates.date ? new Date(updates.date).toISOString() : null,
            updates.plateIn,
            updates.plateOut,
            updates.base,
            updates.notes,
            req.session.user.username,
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Troca não encontrada' });
        }
        
        const updatedSwap = result.rows[0];

        res.json({
            success: true,
            ...updatedSwap,
            dateFormatted: formatDateBR(updatedSwap.date),
            entityType: 'swap',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro ao atualizar troca:', err);
        res.status(500).json({ error: 'Erro ao atualizar troca' });
    }
});

app.delete('/api/swaps/:id', requireAuth, requireRole(['admin']), logAction('SWAP_DELETED'), async (req, res) => {
    const { id } = req.params;
    
    try {
        await pool.query('DELETE FROM swaps WHERE id = $1', [id]);
        res.json({
            success: true,
            entityType: 'swap',
            entityId: parseInt(id)
        });
    } catch (err) {
        console.error('Erro ao deletar troca:', err);
        res.status(500).json({ error: 'Erro ao deletar troca' });
    }
});

// ============ ESTATÍSTICAS ============
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const activeResult = await pool.query("SELECT * FROM vehicles WHERE status != 'Liberado'");
        const liberatedResult = await pool.query("SELECT * FROM vehicles WHERE status = 'Liberado'");
        
        const active = activeResult.rows;
        const liberated = liberatedResult.rows;

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
            const entry = new Date(v.entrytime);
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
            totalGeral: active.length + liberated.length,
            stalledVehicles: stalledVehicles.length,
            stalledVehiclesList: stalledVehicles.map(v => ({ 
                id: v.id, 
                plate: v.plate, 
                hours: Math.round((now - new Date(v.entrytime)) / (1000 * 60 * 60)) 
            })),
            lastUpdated: new Date().toISOString()
        };

        res.json(stats);
    } catch (err) {
        console.error('Erro ao buscar estatísticas:', err);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// ============ AUDITORIA ============
app.get('/api/audit', requireAuth, requireRole(['admin']), async (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT * FROM audit_log 
            ORDER BY timestamp DESC 
            LIMIT $1 OFFSET $2
        `, [parseInt(limit), parseInt(offset)]);

        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar auditoria:', err);
        res.status(500).json({ error: 'Erro ao buscar auditoria' });
    }
});

// ============ IMPORTAR/EXPORTAR ============
app.post('/api/import', requireAuth, requireRole(['admin']), logAction('DATA_IMPORTED'), async (req, res) => {
    const { vehicles: importedVehicles, swaps: importedSwaps } = req.body;
    
    if (!Array.isArray(importedVehicles)) {
        return res.status(400).json({ error: 'Dados devem conter: {"vehicles": [...]} ' });
    }

    try {
        // Backup antes de importar
        const backup = {
            vehicles: (await pool.query('SELECT * FROM vehicles')).rows,
            swaps: (await pool.query('SELECT * FROM swaps')).rows,
            exportedAt: new Date().toISOString(),
            backedUpBy: req.session.user.username
        };
        
        // Limpar dados existentes
        await pool.query('DELETE FROM vehicles');
        await pool.query('DELETE FROM swaps');
        
        let imported = 0;
        let errors = 0;

        for (const v of importedVehicles) {
            if (v.plate && v.type && v.yard) {
                try {
                    await pool.query(`
                        INSERT INTO vehicles (plate, type, yard, base, status, maintenance, keys, notes, entrytime, exittime, updatedby)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    `, [
                        v.plate.toUpperCase(),
                        v.type,
                        v.yard,
                        v.base || 'Jaraguá-SP',
                        v.status || 'Aguardando linha',
                        v.maintenance || false,
                        v.keys || '',
                        v.notes || '',
                        v.entryTime || new Date().toISOString(),
                        v.exitTime || null,
                        req.session.user.username
                    ]);
                    imported++;
                } catch (e) {
                    errors++;
                }
            } else {
                errors++;
            }
        }

        if (Array.isArray(importedSwaps)) {
            for (const s of importedSwaps) {
                if (s.plateOut) {
                    try {
                        await pool.query(`
                            INSERT INTO swaps (date, platein, plateout, base, notes, updatedby)
                            VALUES ($1, $2, $3, $4, $5, $6)
                        `, [
                            s.date || new Date().toISOString(),
                            s.plateIn || '0000',
                            s.plateOut,
                            s.base || '',
                            s.notes || '',
                            req.session.user.username
                        ]);
                    } catch (e) {}
                }
            }
        }

        res.json({ 
            success: true, 
            imported, 
            errors, 
            message: `✅ ${imported} veículo(s) importado(s).`,
            entityType: 'system',
            entityId: 0
        });
    } catch (err) {
        console.error('Erro ao importar:', err);
        res.status(500).json({ error: 'Erro ao importar dados' });
    }
});

app.get('/api/export', requireAuth, async (req, res) => {
    try {
        const vehicles = (await pool.query('SELECT * FROM vehicles')).rows;
        const swaps = (await pool.query('SELECT * FROM swaps')).rows;
        
        const data = {
            vehicles,
            swaps,
            exportedAt: new Date().toISOString(),
            version: '5.2-postgresql',
            exportedBy: req.session.user.username
        };
        res.json(data);
    } catch (err) {
        console.error('Erro ao exportar:', err);
        res.status(500).json({ error: 'Erro ao exportar dados' });
    }
});

// ============ FUNÇÕES AUXILIARES ============
function formatDateBR(dateString) {
    if (!dateString) return '—';
    
    const date = new Date(dateString);
    
    const options = {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
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
    console.log('🚚 CONTROLE DE PÁTIO PRINT - v5.2 (PostgreSQL)');
    console.log('='.repeat(60));
    console.log(`📍 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('🔐 Sistema iniciado. Consulte o administrador para credenciais.');
    console.log('='.repeat(60));
    console.log('💾 Banco: PostgreSQL');
    console.log('🕐 Fuso: America/Sao_Paulo (UTC-3)');
    console.log('='.repeat(60) + '\n');
});