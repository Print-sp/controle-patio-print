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
        hasAccident: row.hasaccident || false, documentIssue: row.documentissue || false, sascarStatus: row.sascarstatus || 'pendente',
        keys: row.keys, notes: row.notes,
        isNewVehicle: row.isnewvehicle || false,
        newVehiclePlotagem: row.newvehicleplotagem || false,
        newVehicleTesteDrive: row.newvehiculetestedrive || false,
        newVehicleAdesivoCorreios: row.newvehicleadesivocorreios || false,
        newVehicleAdesivoPrint: row.newvehicleadesivoprint || false,
        newVehicleMarcacaoPneus: row.newvehiclemarcacaopneus || false,
        newVehiclePlataformaCarga: row.newvehicleplataformacarga || false,
        newVehicleForracaoInterna: row.newvehicleforracaointerna || false,
        newVehicleNotes: row.newvehiclenotes || '',
        hasNewLine: row.hasnewline || false,
        newLineName: row.newlinename || '',
        newLineState: row.newlinestate || '',
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
        id: row.id, date: row.date, plateIn: row.platein || row.plateIn, plateOut: row.plateout || row.plateOut,
        base: row.base, baseDestino: row.basedestino || row.baseDestino || '', notes: row.notes, tipo: row.tipo || 'troca',
        returnedAt: row.returnedat || row.returnedAt || null,
        returnYard: row.returnyard || row.returnYard || '',
        returnVehicleId: row.returnvehicleid || row.returnVehicleId || null,
        returnDetectedBy: row.returndetectedby || row.returnDetectedBy || '',
        createdAt: row.createdat || row.createdAt, updatedBy: row.updatedby || row.updatedBy
    };
}

function mapConjuntoRow(row) {
    if (!row) return null;
    return {
        id: row.id, date: row.date,
        cavaloPlate: row.cavaloplate || row.cavaloPlate,
        carretaPlate: row.carretaplate || row.carretaPlate,
        yard: row.yard || '',
        base: row.base || '',
        baseDestino: row.basedestino || row.baseDestino || '',
        leaderName: row.leadername || row.leaderName || '',
        notes: row.notes || '',
        createdAt: row.createdat || row.createdAt,
        updatedBy: row.updatedby || row.updatedBy
    };
}

function pickFirstDefined(obj, keys, fallback = undefined) {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null) {
            return obj[key];
        }
    }
    return fallback;
}

function canonicalText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/á|â|ã|ä|á|â|ã|à|ä/g, 'a')
        .replace(/ç|ç/g, 'c')
        .replace(/é|ê|è|ë|é|ê|è|ë/g, 'e')
        .replace(/í|ì|î|ï|í|ì|î|ï/g, 'i')
        .replace(/ó|ô|õ|ö|ó|ô|õ|ò|ö/g, 'o')
        .replace(/ú|ù|û|ü|ú|ù|û|ü/g, 'u')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function canonicalizeVehicleType(type) {
    const normalized = canonicalText(type);
    if (normalized.includes('cavalo mec')) return 'Cavalo Mecânico';
    if (normalized.includes('carreta')) return 'Carreta';
    if (normalized.includes('van')) return 'Van';
    if (normalized.includes('vuc') || normalized.includes('3 4') || normalized.includes('tres quartos')) return 'VUC / 3/4';
    if (normalized.includes('truck')) return 'Caminhão Truck';
    if (normalized.includes('toco')) return 'Caminhão Toco';
    if (normalized.includes('visitante')) return 'Veículo Visitante';
    if (normalized.includes('diretoria')) return 'Veículo Diretoria';
    return String(type || '').trim();
}

function canonicalizeVehicleStatus(status) {
    const normalized = canonicalText(status);
    if (normalized.includes('aguardando linha')) return 'Aguardando linha';
    if (normalized.includes('aguardando abaste')) return 'Aguardando abastecimento';
    if (normalized.includes('aguardando manut')) return 'Aguardando manutenção';
    if (normalized.includes('em manut')) return 'Em manutenção';
    if (normalized.includes('funilar')) return 'Funilaria';
    if (normalized.includes('borrachar')) return 'Borracharia';
    if (normalized.includes('liberad')) return 'Liberado';
    if (normalized.includes('sinistro')) return 'Sinistro';
    return String(status || 'Aguardando linha').trim() || 'Aguardando linha';
}

function normalizePlateValue(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = canonicalText(value);
    if (!normalized) return false;
    if (['1', 'true', 'sim', 'yes', 'on', 'checked'].includes(normalized)) return true;
    if (['0', 'false', 'nao', 'no', 'off'].includes(normalized)) return false;
    return Boolean(value);
}

function canonicalizeBaseLocation(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const normalized = canonicalText(trimmed);
    if (normalized.includes('vitoria da conquista')) return 'Vitória da Conquista BA';
    return trimmed;
}

function canonicalizeSascarStatus(status) {
    const normalized = canonicalText(status);
    if (normalized.includes('instal')) return 'instalado';
    if (normalized.includes('manut')) return 'manutencao';
    if (normalized.includes('nao aplic')) return 'nao_aplicavel';
    return 'pendente';
}

function canonicalizeMaintenanceCategory(category) {
    const normalized = canonicalText(category);
    if (normalized.includes('funilar')) return 'funilaria';
    if (normalized.includes('mecan')) return 'mecanica';
    if (normalized.includes('borrach')) return 'borracharia';
    if (normalized.includes('eletr')) return 'eletrica';
    if (normalized.includes('frei')) return 'freios';
    if (normalized.includes('bau')) return 'bau';
    return '';
}

function normalizeVehicleRecord(vehicle) {
    if (!vehicle || typeof vehicle !== 'object') return vehicle;
    const normalizedType = canonicalizeVehicleType(vehicle.type);
    return {
        ...vehicle,
        type: normalizedType,
        status: canonicalizeVehicleStatus(vehicle.status),
        base: canonicalizeBaseLocation(vehicle.base),
        baseDestino: canonicalizeBaseLocation(vehicle.baseDestino ?? vehicle.basedestino),
        sascarStatus: canonicalizeSascarStatus(vehicle.sascarStatus),
        maintenanceCategory: canonicalizeMaintenanceCategory(vehicle.maintenanceCategory),
        maintenance: Boolean(vehicle.maintenance),
        hasAccident: Boolean(vehicle.hasAccident),
        documentIssue: Boolean(vehicle.documentIssue),
        isNewVehicle: Boolean(vehicle.isNewVehicle ?? vehicle.isnewvehicle),
        newVehiclePlotagem: Boolean(vehicle.newVehiclePlotagem ?? vehicle.newvehicleplotagem),
        newVehicleTesteDrive: Boolean(vehicle.newVehicleTesteDrive ?? vehicle.newvehiculetestedrive),
        newVehicleAdesivoCorreios: Boolean(vehicle.newVehicleAdesivoCorreios ?? vehicle.newvehicleadesivocorreios),
        newVehicleAdesivoPrint: Boolean(vehicle.newVehicleAdesivoPrint ?? vehicle.newvehicleadesivoprint),
        newVehicleMarcacaoPneus: Boolean(vehicle.newVehicleMarcacaoPneus ?? vehicle.newvehiclemarcacaopneus),
        newVehiclePlataformaCarga: Boolean(vehicle.newVehiclePlataformaCarga ?? vehicle.newvehicleplataformacarga),
        newVehicleForracaoInterna: normalizedType === 'Van' && Boolean(vehicle.newVehicleForracaoInterna ?? vehicle.newvehicleforracaointerna),
        newVehicleNotes: String(vehicle.newVehicleNotes ?? vehicle.newvehiclenotes ?? '').trim(),
        hasNewLine: Boolean(vehicle.hasNewLine ?? vehicle.hasnewline),
        newLineName: String(vehicle.newLineName ?? vehicle.newlinename ?? '').trim(),
        newLineState: String(vehicle.newLineState ?? vehicle.newlinestate ?? '').trim(),
        entregarDiversos: Boolean(vehicle.entregarDiversos ?? vehicle.entregar_diversos),
        entregarCorreios: Boolean(vehicle.entregarCorreios ?? vehicle.entregar_correios),
        entregue: Boolean(vehicle.entregue)
    };
}

function getConsistentVehicleTimes(vehicle) {
    const normalizedStatus = canonicalizeVehicleStatus(vehicle?.status);
    return {
        entryTime: vehicle?.entryTime || vehicle?.entrytime || null,
        exitTime: normalizedStatus === 'Liberado' ? (vehicle?.exitTime || vehicle?.exittime || null) : null,
        readyTime: normalizedStatus === 'Liberado' ? (vehicle?.readyTime || vehicle?.readytime || null) : null
    };
}

async function repairVehicleTimelineConsistency() {
    if (isProduction) {
        const result = await pool.query(`
            UPDATE vehicles
            SET exitTime = NULL,
                readyTime = NULL,
                updatedAt = CURRENT_TIMESTAMP
            WHERE status <> 'Liberado'
              AND (exitTime IS NOT NULL OR readyTime IS NOT NULL)
        `);
        if (result.rowCount > 0) {
            console.log(`🧹 Corrigidos ${result.rowCount} veículo(s) ativos com saída/pronto inconsistentes`);
        }
        return;
    }

    const result = db.prepare(`
        UPDATE vehicles
        SET exitTime = NULL,
            readyTime = NULL,
            updatedAt = ?
        WHERE status <> 'Liberado'
          AND (exitTime IS NOT NULL OR readyTime IS NOT NULL)
    `).run(new Date().toISOString());
    if (result.changes > 0) {
        console.log(`🧹 Corrigidos ${result.changes} veículo(s) ativos com saída/pronto inconsistentes`);
    }
}

function normalizeImportedVehicle(v) {
    if (!v || typeof v !== 'object') return null;
    return {
        plate: pickFirstDefined(v, ['plate', 'Plate'], ''),
        type: pickFirstDefined(v, ['type', 'Type'], ''),
        yard: pickFirstDefined(v, ['yard', 'Yard'], ''),
        base: canonicalizeBaseLocation(pickFirstDefined(v, ['base', 'Base'], 'Jaraguá-SP (Nacional)')),
        baseDestino: canonicalizeBaseLocation(pickFirstDefined(v, ['baseDestino', 'basedestino', 'base_destino', 'BaseDestino'], '')),
        manager: pickFirstDefined(v, ['manager', 'Manager'], ''),
        chassis: pickFirstDefined(v, ['chassis', 'Chassis'], ''),
        status: pickFirstDefined(v, ['status', 'Status'], 'Aguardando linha'),
        maintenance: normalizeBooleanFlag(pickFirstDefined(v, ['maintenance', 'Maintenance'], false)),
        maintenanceCategory: pickFirstDefined(v, ['maintenanceCategory', 'maintenancecategory', 'maintenance_category'], ''),
        hasAccident: normalizeBooleanFlag(pickFirstDefined(v, ['hasAccident', 'hasaccident', 'has_accident'], false)),
        documentIssue: normalizeBooleanFlag(pickFirstDefined(v, ['documentIssue', 'documentissue', 'document_issue', 'problemaDocumentacao', 'problema_documentacao'], false)),
        sascarStatus: pickFirstDefined(v, ['sascarStatus', 'sascarstatus', 'sascar_status'], 'pendente'),
        keys: pickFirstDefined(v, ['keys', 'Keys'], ''),
        notes: pickFirstDefined(v, ['notes', 'Notes'], ''),
        isNewVehicle: normalizeBooleanFlag(pickFirstDefined(v, ['isNewVehicle', 'isnewvehicle', 'is_new_vehicle'], false)),
        newVehiclePlotagem: normalizeBooleanFlag(pickFirstDefined(v, ['newVehiclePlotagem', 'newvehicleplotagem', 'new_vehicle_plotagem'], false)),
        newVehicleTesteDrive: normalizeBooleanFlag(pickFirstDefined(v, ['newVehicleTesteDrive', 'newvehiculetestedrive', 'new_vehicle_teste_drive'], false)),
        newVehicleAdesivoCorreios: normalizeBooleanFlag(pickFirstDefined(v, ['newVehicleAdesivoCorreios', 'newvehicleadesivocorreios', 'new_vehicle_adesivo_correios'], false)),
        newVehicleAdesivoPrint: normalizeBooleanFlag(pickFirstDefined(v, ['newVehicleAdesivoPrint', 'newvehicleadesivoprint', 'new_vehicle_adesivo_print'], false)),
        newVehicleMarcacaoPneus: normalizeBooleanFlag(pickFirstDefined(v, ['newVehicleMarcacaoPneus', 'newvehiclemarcacaopneus', 'new_vehicle_marcacao_pneus'], false)),
        newVehiclePlataformaCarga: normalizeBooleanFlag(pickFirstDefined(v, ['newVehiclePlataformaCarga', 'newvehicleplataformacarga', 'new_vehicle_plataforma_carga'], false)),
        newVehicleForracaoInterna: normalizeBooleanFlag(pickFirstDefined(v, ['newVehicleForracaoInterna', 'newvehicleforracaointerna', 'new_vehicle_forracao_interna'], false)),
        newVehicleNotes: pickFirstDefined(v, ['newVehicleNotes', 'newvehiclenotes', 'new_vehicle_notes'], ''),
        hasNewLine: normalizeBooleanFlag(pickFirstDefined(v, ['hasNewLine', 'hasnewline', 'has_new_line'], false)),
        newLineName: pickFirstDefined(v, ['newLineName', 'newlinename', 'new_line_name'], ''),
        newLineState: pickFirstDefined(v, ['newLineState', 'newlinestate', 'new_line_state'], ''),
        entregarDiversos: normalizeBooleanFlag(pickFirstDefined(v, ['entregarDiversos', 'entregar_diversos'], false)),
        entregarCorreios: normalizeBooleanFlag(pickFirstDefined(v, ['entregarCorreios', 'entregar_correios'], false)),
        entregue: normalizeBooleanFlag(pickFirstDefined(v, ['entregue', 'Entregue'], false)),
        entreguePara: pickFirstDefined(v, ['entreguePara', 'entreguepara', 'entregue_para'], ''),
        readyTime: pickFirstDefined(v, ['readyTime', 'readytime'], null),
        entryTime: pickFirstDefined(v, ['entryTime', 'entrytime'], new Date().toISOString()),
        exitTime: pickFirstDefined(v, ['exitTime', 'exittime'], null)
    };
}

function normalizeImportedSwap(s) {
    if (!s || typeof s !== 'object') return null;
    return {
        date: pickFirstDefined(s, ['date', 'Date'], new Date().toISOString()),
        plateIn: pickFirstDefined(s, ['plateIn', 'platein', 'plate_in'], '0000'),
        plateOut: pickFirstDefined(s, ['plateOut', 'plateout', 'plate_out'], ''),
        base: canonicalizeBaseLocation(pickFirstDefined(s, ['base', 'Base'], '')),
        baseDestino: canonicalizeBaseLocation(pickFirstDefined(s, ['baseDestino', 'basedestino', 'base_destino', 'BaseDestino'], '')),
        notes: pickFirstDefined(s, ['notes', 'Notes', 'observacoes', 'observação', 'observacao'], ''),
        tipo: pickFirstDefined(s, ['tipo', 'type', 'Tipo'], 'troca'),
        returnedAt: pickFirstDefined(s, ['returnedAt', 'returnedat', 'returned_at'], null),
        returnYard: pickFirstDefined(s, ['returnYard', 'returnyard', 'return_yard'], ''),
        returnVehicleId: pickFirstDefined(s, ['returnVehicleId', 'returnvehicleid', 'return_vehicle_id'], null),
        returnDetectedBy: pickFirstDefined(s, ['returnDetectedBy', 'returndetectedby', 'return_detected_by'], '')
    };
}

function resolveImportedSwaps(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.swaps)) return payload.swaps;
    if (Array.isArray(payload.trocas)) return payload.trocas;
    const merged = [];
    if (Array.isArray(payload.emprestimos)) merged.push(...payload.emprestimos.map(item => ({ ...item, tipo: item?.tipo || 'emprestimo' })));
    if (Array.isArray(payload.trocasEEmprestimos)) merged.push(...payload.trocasEEmprestimos);
    return merged;
}

function normalizeImportedConjunto(c) {
    if (!c || typeof c !== 'object') return null;
    return {
        date: pickFirstDefined(c, ['date', 'Date'], new Date().toISOString()),
        cavaloPlate: pickFirstDefined(c, ['cavaloPlate', 'cavaloplate', 'cavalo_plate', 'placaCavalo'], ''),
        carretaPlate: pickFirstDefined(c, ['carretaPlate', 'carretaplate', 'carreta_plate', 'placaCarreta'], ''),
        yard: pickFirstDefined(c, ['yard', 'Yard'], ''),
        base: canonicalizeBaseLocation(pickFirstDefined(c, ['base', 'Base'], '')),
        baseDestino: canonicalizeBaseLocation(pickFirstDefined(c, ['baseDestino', 'basedestino', 'base_destino', 'BaseDestino'], '')),
        leaderName: pickFirstDefined(c, ['leaderName', 'leadername', 'leader_name', 'nomeLider', 'nome_lider'], ''),
        notes: pickFirstDefined(c, ['notes', 'Notes', 'observacoes', 'observacao'], '')
    };
}

function resolveImportedConjuntos(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.conjuntos)) return payload.conjuntos;
    const merged = [];
    if (Array.isArray(payload.conjuntosMontados)) merged.push(...payload.conjuntosMontados);
    if (Array.isArray(payload.mountedSets)) merged.push(...payload.mountedSets);
    return merged;
}

const systemYardOptions = ['Pátio Jaraguá', 'Pátio Bandeirantes', 'Pátio Superior', 'Pátio Cajamar'];
const systemBaseOptions = [
    'Jaraguá-SP (Nacional)',
    'Brasília',
    'São Luís MA',
    'Belém-PA',
    'Campo Grande-MS',
    'Feira de Santana BA',
    'Vitória da Conquista BA',
    'Salvador-BA',
    'Vitória-ES',
    'Recife-PE',
    'Fortaleza-CE',
    'São Paulo-SP',
    'Rio de Janeiro-RJ',
    'Curitiba-PR',
    'Porto Alegre-RS',
    'Minas Gerais',
    'Manaus',
    'Tocantins',
    'Mato Grosso',
    'Pernambuco',
    'Alagoas'
];

const userYardPermissions = {
    admin: systemYardOptions,
    cajamar: ['Pátio Cajamar'],
    bandeirantes: ['Pátio Bandeirantes'],
    jaragua: ['Pátio Jaraguá', 'Pátio Superior']
};

function getUserAllowedYards(username) {
    return userYardPermissions[username.toLowerCase()] || [];
}

function canonicalizeOccurrenceBranch(branch) {
    const canonical = canonicalizeBaseLocation(branch);
    const normalized = canonicalText(canonical);
    if (!normalized) return '';

    const exactMatch = systemBaseOptions.find(option => canonicalText(option) === normalized);
    if (exactMatch) return exactMatch;

    const partialMatches = systemBaseOptions.filter(option => {
        const optionNormalized = canonicalText(option);
        return optionNormalized.includes(normalized) || normalized.includes(optionNormalized);
    });

    if (partialMatches.length === 1) {
        return partialMatches[0];
    }

    return canonical;
}

function sortBaseOptionRecords(records) {
    return [...records].sort((left, right) => {
        const leftName = String(left?.name || '');
        const rightName = String(right?.name || '');
        if (leftName === systemBaseOptions[0]) return -1;
        if (rightName === systemBaseOptions[0]) return 1;
        return leftName.localeCompare(rightName, 'pt-BR', { sensitivity: 'base' });
    });
}

async function listBaseOptions() {
    const fallback = sortBaseOptionRecords(systemBaseOptions.map((name, index) => ({ id: index + 1, name })));

    try {
        if (isProduction) {
            const result = await pool.query('SELECT id, name FROM base_options');
            return sortBaseOptionRecords(result.rows.map(row => ({
                id: row.id,
                name: canonicalizeOccurrenceBranch(row.name)
            })));
        }

        return sortBaseOptionRecords(db.prepare('SELECT id, name FROM base_options').all().map(row => ({
            id: row.id,
            name: canonicalizeOccurrenceBranch(row.name)
        })));
    } catch (error) {
        return fallback;
    }
}

async function getOccurrenceBranchOptions() {
    const baseOptions = await listBaseOptions();
    return baseOptions.map(option => option.name);
}

function filterVehiclesByUserYards(vehicles, username) {
    const allowedYards = getUserAllowedYards(username);
    if (allowedYards.length === 0) return vehicles;
    return vehicles.filter(v => allowedYards.includes(v.yard));
}

function filterConjuntosByUserYards(conjuntos, username) {
    const allowedYards = getUserAllowedYards(username);
    if (allowedYards.length === 0) return conjuntos;
    return conjuntos.filter(c => !c.yard || allowedYards.includes(c.yard));
}

function canChangeLiberadoStatus(user) {
    return user.role === 'admin' || 
           user.username?.toLowerCase() === 'bandeirantes' || 
           user.username?.toLowerCase() === 'jaragua' ||
           (user.yards || []).includes('Pátio Bandeirantes') ||
           (user.yards || []).includes('Pátio Jaraguá');
}

const occurrenceSeed = {
    branches: systemBaseOptions,
    tripTypes: ['Entrega', 'Coleta', 'Transferência'],
    lines: ['Linha 1', 'Linha 2', 'Linha 3'],
    plates: ['ABC1D23', 'DEF4G56', 'HIJ7K89'],
        vehicleTypes: ['Truck', 'Carreta', 'Van', 'VUC / 3/4'],
    reasons: ['Manutenção', 'Avaria', 'Abastecimento'],
    subcategories: ['Motor', 'Pneu', 'Freio'],
    details: ['Troca de óleo', 'Troca de pneu', 'Revisão geral']
};

const MASTER_DATA_CONFIG = Object.freeze({
    bases: { label: 'Bases', table: 'base_options' },
    tripTypes: { label: 'Tipos de Viagem', table: 'occurrence_trip_types' },
    lines: { label: 'Linhas', table: 'occurrence_lines' },
    plates: { label: 'Placas', table: 'occurrence_plates' },
    vehicleTypes: { label: 'Tipos de Veículo', table: 'occurrence_vehicle_types' },
    reasons: { label: 'Motivos', table: 'occurrence_reasons' },
    subcategories: { label: 'Subcategorias', table: 'occurrence_subcategories' },
    details: { label: 'Detalhamentos', table: 'occurrence_details' }
});

function normalizeMasterDataValue(type, value) {
    if (type === 'bases') return canonicalizeOccurrenceBranch(value);
    if (type === 'plates') return normalizePlateValue(value);
    return String(value || '').trim();
}

function getMasterDataConfig(type) {
    return MASTER_DATA_CONFIG[type] || null;
}

async function listOptionTableValues(table) {
    if (isProduction) {
        const result = await pool.query(`SELECT name FROM ${table} ORDER BY name`);
        return result.rows.map(row => String(row.name || '').trim()).filter(Boolean);
    }

    return db.prepare(`SELECT name FROM ${table} ORDER BY name`).all().map(row => String(row.name || '').trim()).filter(Boolean);
}

async function listMasterDataValues(type) {
    if (type === 'bases') {
        return (await listBaseOptions()).map(option => option.name);
    }

    const config = getMasterDataConfig(type);
    if (!config) return [];
    return listOptionTableValues(config.table);
}

async function listMasterDataBundle() {
    const entries = await Promise.all(
        Object.keys(MASTER_DATA_CONFIG).map(async (type) => [type, await listMasterDataValues(type)])
    );
    return Object.fromEntries(entries);
}

async function createMasterDataValue(type, rawValue) {
    const config = getMasterDataConfig(type);
    if (!config) throw new Error('Tipo de cadastro inválido');

    const name = normalizeMasterDataValue(type, rawValue);
    if (!name) throw new Error('Informe um valor válido');

    const existingValues = await listMasterDataValues(type);
    if (existingValues.some(value => canonicalText(value) === canonicalText(name))) {
        const duplicateError = new Error('duplicate');
        duplicateError.code = 'DUPLICATE';
        throw duplicateError;
    }

    if (isProduction) {
        const result = await pool.query(
            `INSERT INTO ${config.table} (name) VALUES ($1) RETURNING id, name`,
            [name]
        );
        return {
            id: result.rows[0].id,
            name: normalizeMasterDataValue(type, result.rows[0].name)
        };
    }

    const insert = db.prepare(`INSERT INTO ${config.table} (name) VALUES (?)`).run(name);
    const row = db.prepare(`SELECT id, name FROM ${config.table} WHERE id = ?`).get(insert.lastInsertRowid);
    return {
        id: row.id,
        name: normalizeMasterDataValue(type, row.name)
    };
}

function normalizeAuditDetails(details) {
    if (!details || typeof details !== 'object') return {};
    return JSON.parse(JSON.stringify(details));
}

async function recordAuditEvent(req, { entityType, entityId = '', action, summary = '', details = {} }) {
    const normalizedDetails = normalizeAuditDetails(details);
    const username = req?.session?.user?.username || 'system';

    try {
        if (isProduction) {
            await pool.query(
                `INSERT INTO audit_logs (entityType, entityId, action, summary, details, username)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [entityType, String(entityId || ''), action, summary, JSON.stringify(normalizedDetails), username]
            );
            return;
        }

        db.prepare(
            `INSERT INTO audit_logs (entityType, entityId, action, summary, details, username)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(entityType, String(entityId || ''), action, summary, JSON.stringify(normalizedDetails), username);
    } catch (error) {
        console.error('Erro ao registrar auditoria:', error);
    }
}

function normalizeOccurrenceRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        tripNumber: row.tripnumber ?? row.tripNumber,
        tripDate: row.tripdate ?? row.tripDate,
        branch: canonicalizeOccurrenceBranch(row.branch),
        tripType: row.triptype ?? row.tripType,
        line: row.line,
        plate: row.plate,
        vehicleType: row.vehicletype ?? row.vehicleType,
        reason: row.reason,
        subcategory: row.subcategory,
        detail: row.detail,
        serviceOrder: row.serviceorder ?? row.serviceOrder ?? '',
        observation: row.observation ?? '',
        createdAt: row.createdat ?? row.createdAt,
        updatedAt: row.updatedat ?? row.updatedAt
    };
}

function validateOccurrencePayload(payload) {
    const tripNumber = Number.parseInt(payload?.tripNumber, 10);
    if (!Number.isInteger(tripNumber) || tripNumber <= 0) {
        return { error: 'Número da viagem inválido' };
    }

    const tripDate = String(payload?.tripDate || '').trim();
    if (!tripDate) return { error: 'Data da viagem é obrigatória' };

    return {
        value: {
            tripNumber,
            tripDate,
            branch: canonicalizeOccurrenceBranch(payload?.branch),
            tripType: String(payload?.tripType || '').trim(),
            line: String(payload?.line || '').trim(),
            plate: String(payload?.plate || '').trim().toUpperCase(),
            vehicleType: String(payload?.vehicleType || '').trim(),
            reason: String(payload?.reason || '').trim(),
            subcategory: String(payload?.subcategory || '').trim(),
            detail: String(payload?.detail || '').trim(),
            serviceOrder: String(payload?.serviceOrder || '').trim(),
            observation: String(payload?.observation || '').trim()
        }
    };
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
                    hasAccident BOOLEAN DEFAULT false, documentIssue BOOLEAN DEFAULT false, sascarStatus TEXT DEFAULT 'pendente',
                    keys TEXT DEFAULT '', notes TEXT DEFAULT '',
                    isNewVehicle BOOLEAN DEFAULT false,
                    newVehiclePlotagem BOOLEAN DEFAULT false,
                    newVehicleTesteDrive BOOLEAN DEFAULT false,
                    newVehicleAdesivoCorreios BOOLEAN DEFAULT false,
                    newVehicleAdesivoPrint BOOLEAN DEFAULT false,
                    newVehicleMarcacaoPneus BOOLEAN DEFAULT false,
                    newVehiclePlataformaCarga BOOLEAN DEFAULT false,
                    newVehicleForracaoInterna BOOLEAN DEFAULT false,
                    newVehicleNotes TEXT DEFAULT '',
                    hasNewLine BOOLEAN DEFAULT false,
                    newLineName TEXT DEFAULT '',
                    newLineState TEXT DEFAULT '',
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
                    returnedAt TIMESTAMP, returnYard TEXT DEFAULT '',
                    returnVehicleId INTEGER, returnDetectedBy TEXT DEFAULT '',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS conjuntos (
                    id SERIAL PRIMARY KEY,
                    date TIMESTAMP NOT NULL,
                    cavaloPlate TEXT NOT NULL,
                    carretaPlate TEXT NOT NULL,
                    yard TEXT DEFAULT '',
                    base TEXT DEFAULT '',
                    baseDestino TEXT DEFAULT '',
                    leaderName TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
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
                CREATE TABLE IF NOT EXISTS base_options (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id SERIAL PRIMARY KEY,
                    entityType TEXT NOT NULL,
                    entityId TEXT DEFAULT '',
                    action TEXT NOT NULL,
                    summary TEXT DEFAULT '',
                    details JSONB DEFAULT '{}'::jsonb,
                    username TEXT DEFAULT 'system',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS occurrence_branches (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_trip_types (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_lines (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_plates (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_vehicle_types (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_reasons (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_subcategories (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_details (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrences (
                    id SERIAL PRIMARY KEY,
                    tripNumber INTEGER NOT NULL UNIQUE,
                    tripDate DATE NOT NULL,
                    branch TEXT DEFAULT '',
                    tripType TEXT DEFAULT '',
                    line TEXT DEFAULT '',
                    plate TEXT DEFAULT '',
                    vehicleType TEXT DEFAULT '',
                    reason TEXT DEFAULT '',
                    subcategory TEXT DEFAULT '',
                    detail TEXT DEFAULT '',
                    serviceOrder TEXT DEFAULT '',
                    observation TEXT DEFAULT '',
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
                CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
                CREATE INDEX IF NOT EXISTS idx_occurrences_tripnumber ON occurrences(tripNumber);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_createdat ON audit_logs(createdAt DESC);
            `);
            
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hasAccident BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS documentIssue BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sascarStatus TEXT DEFAULT 'pendente'`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS maintenanceCategory TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS readyTime TIMESTAMP`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS isNewVehicle BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehiclePlotagem BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleTesteDrive BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleAdesivoCorreios BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleAdesivoPrint BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleMarcacaoPneus BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehiclePlataformaCarga BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleForracaoInterna BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newVehicleNotes TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hasNewLine BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newLineName TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS newLineState TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregar_diversos BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregar_correios BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entregue BOOLEAN DEFAULT false`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS entreguePara TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS baseDestino TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'troca'`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS baseDestino TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS returnedAt TIMESTAMP`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS returnYard TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS returnVehicleId INTEGER`);
            await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS returnDetectedBy TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE conjuntos ADD COLUMN IF NOT EXISTS yard TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE conjuntos ADD COLUMN IF NOT EXISTS baseDestino TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE conjuntos ADD COLUMN IF NOT EXISTS leaderName TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS yards JSONB DEFAULT '[]'`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS tripType TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS line TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS plate TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS vehicleType TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS detail TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS serviceOrder TEXT DEFAULT ''`);
            await pool.query(`ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS observation TEXT DEFAULT ''`);
            
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

            const optionTables = [
                ['base_options', systemBaseOptions],
                ['occurrence_branches', occurrenceSeed.branches],
                ['occurrence_trip_types', occurrenceSeed.tripTypes],
                ['occurrence_lines', occurrenceSeed.lines],
                ['occurrence_plates', occurrenceSeed.plates],
                ['occurrence_vehicle_types', occurrenceSeed.vehicleTypes],
                ['occurrence_reasons', occurrenceSeed.reasons],
                ['occurrence_subcategories', occurrenceSeed.subcategories],
                ['occurrence_details', occurrenceSeed.details]
            ];

            for (const [table, values] of optionTables) {
                for (const value of values) {
                    await pool.query(`INSERT INTO ${table} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [value]);
                }
            }

            await repairVehicleTimelineConsistency();
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
                    hasAccident INTEGER DEFAULT 0, documentIssue INTEGER DEFAULT 0, sascarStatus TEXT DEFAULT 'pendente',
                    keys TEXT DEFAULT '', notes TEXT DEFAULT '',
                    isNewVehicle INTEGER DEFAULT 0,
                    newVehiclePlotagem INTEGER DEFAULT 0,
                    newVehicleTesteDrive INTEGER DEFAULT 0,
                    newVehicleAdesivoCorreios INTEGER DEFAULT 0,
                    newVehicleAdesivoPrint INTEGER DEFAULT 0,
                    newVehicleMarcacaoPneus INTEGER DEFAULT 0,
                    newVehiclePlataformaCarga INTEGER DEFAULT 0,
                    newVehicleForracaoInterna INTEGER DEFAULT 0,
                    newVehicleNotes TEXT DEFAULT '',
                    hasNewLine INTEGER DEFAULT 0,
                    newLineName TEXT DEFAULT '',
                    newLineState TEXT DEFAULT '',
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
                    returnedAt TEXT, returnYard TEXT DEFAULT '',
                    returnVehicleId INTEGER, returnDetectedBy TEXT DEFAULT '',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedBy TEXT DEFAULT 'system'
                );
                CREATE TABLE IF NOT EXISTS conjuntos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    cavaloPlate TEXT NOT NULL,
                    carretaPlate TEXT NOT NULL,
                    yard TEXT DEFAULT '',
                    base TEXT DEFAULT '',
                    baseDestino TEXT DEFAULT '',
                    leaderName TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
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
                CREATE TABLE IF NOT EXISTS base_options (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entityType TEXT NOT NULL,
                    entityId TEXT DEFAULT '',
                    action TEXT NOT NULL,
                    summary TEXT DEFAULT '',
                    details TEXT DEFAULT '{}',
                    username TEXT DEFAULT 'system',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS occurrence_branches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_trip_types (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_lines (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_plates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_vehicle_types (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_reasons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_subcategories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrence_details (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS occurrences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tripNumber INTEGER NOT NULL UNIQUE,
                    tripDate TEXT NOT NULL,
                    branch TEXT DEFAULT '',
                    tripType TEXT DEFAULT '',
                    line TEXT DEFAULT '',
                    plate TEXT DEFAULT '',
                    vehicleType TEXT DEFAULT '',
                    reason TEXT DEFAULT '',
                    subcategory TEXT DEFAULT '',
                    detail TEXT DEFAULT '',
                    serviceOrder TEXT DEFAULT '',
                    observation TEXT DEFAULT '',
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
                );
            `);
            
            try { db.exec('ALTER TABLE vehicles ADD COLUMN manager TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN chassis TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN hasAccident INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN documentIssue INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN sascarStatus TEXT DEFAULT "pendente"'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN maintenanceCategory TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN readyTime TEXT'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN isNewVehicle INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehiclePlotagem INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleTesteDrive INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleAdesivoCorreios INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleAdesivoPrint INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleMarcacaoPneus INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehiclePlataformaCarga INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleForracaoInterna INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newVehicleNotes TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN hasNewLine INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newLineName TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN newLineState TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregar_diversos INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregar_correios INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entregue INTEGER DEFAULT 0'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN entreguePara TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE vehicles ADD COLUMN baseDestino TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN tipo TEXT DEFAULT "troca"'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN baseDestino TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN returnedAt TEXT'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN returnYard TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN returnVehicleId INTEGER'); } catch(e) {}
            try { db.exec('ALTER TABLE swaps ADD COLUMN returnDetectedBy TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN branch TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN tripType TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN line TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN plate TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN vehicleType TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN reason TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN subcategory TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN detail TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN serviceOrder TEXT DEFAULT ""'); } catch(e) {}
            try { db.exec('ALTER TABLE occurrences ADD COLUMN observation TEXT DEFAULT ""'); } catch(e) {}
            
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

            const sqliteOptionStatements = {
                base_options: db.prepare('INSERT OR IGNORE INTO base_options (name) VALUES (?)'),
                occurrence_branches: db.prepare('INSERT OR IGNORE INTO occurrence_branches (name) VALUES (?)'),
                occurrence_trip_types: db.prepare('INSERT OR IGNORE INTO occurrence_trip_types (name) VALUES (?)'),
                occurrence_lines: db.prepare('INSERT OR IGNORE INTO occurrence_lines (name) VALUES (?)'),
                occurrence_plates: db.prepare('INSERT OR IGNORE INTO occurrence_plates (name) VALUES (?)'),
                occurrence_vehicle_types: db.prepare('INSERT OR IGNORE INTO occurrence_vehicle_types (name) VALUES (?)'),
                occurrence_reasons: db.prepare('INSERT OR IGNORE INTO occurrence_reasons (name) VALUES (?)'),
                occurrence_subcategories: db.prepare('INSERT OR IGNORE INTO occurrence_subcategories (name) VALUES (?)'),
                occurrence_details: db.prepare('INSERT OR IGNORE INTO occurrence_details (name) VALUES (?)')
            };

            systemBaseOptions.forEach(value => sqliteOptionStatements.base_options.run(value));
            occurrenceSeed.branches.forEach(value => sqliteOptionStatements.occurrence_branches.run(value));
            occurrenceSeed.tripTypes.forEach(value => sqliteOptionStatements.occurrence_trip_types.run(value));
            occurrenceSeed.lines.forEach(value => sqliteOptionStatements.occurrence_lines.run(value));
            occurrenceSeed.plates.forEach(value => sqliteOptionStatements.occurrence_plates.run(value));
            occurrenceSeed.vehicleTypes.forEach(value => sqliteOptionStatements.occurrence_vehicle_types.run(value));
            occurrenceSeed.reasons.forEach(value => sqliteOptionStatements.occurrence_reasons.run(value));
            occurrenceSeed.subcategories.forEach(value => sqliteOptionStatements.occurrence_subcategories.run(value));
            occurrenceSeed.details.forEach(value => sqliteOptionStatements.occurrence_details.run(value));

            await repairVehicleTimelineConsistency();
            console.log('✅ SQLite inicializado');
        } catch (err) { console.error('❌ Erro SQLite:', err.message); }
    }
}

initDatabase();

app.use(express.json({ limit: '10mb' }));
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});
app.use(express.static('public'));
app.get('/ocorrencias', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ocorrencias.html'));
});
app.get('/bases', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bases.html'));
});
app.get('/cadastros', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bases.html'));
});
app.get('/auditoria', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'auditoria.html'));
});
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

function buildLoanReturnPayload(swap, vehicle) {
    if (!swap || !vehicle) return null;
    return {
        swapId: swap.id,
        plate: normalizePlateValue(vehicle.plate || swap.plateOut),
        returnedAt: swap.returnedAt || vehicle.entryTime || new Date().toISOString(),
        yard: swap.returnYard || vehicle.yard || '',
        base: swap.base || '',
        baseDestino: swap.baseDestino || '',
        notes: swap.notes || '',
        tipo: swap.tipo || 'troca'
    };
}

async function detectLoanReturnOnEntry(vehicle, updatedBy) {
    const plate = normalizePlateValue(vehicle?.plate);
    const yard = String(vehicle?.yard || '').trim();
    if (!plate || plate === '0000' || !yard) return null;

    if (isProduction) {
        const existing = await pool.query(
            `SELECT * FROM swaps
             WHERE tipo IN ('emprestimo', 'troca')
             AND UPPER(plateOut) = UPPER($1)
             AND returnedAt IS NULL
             ORDER BY date DESC
             LIMIT 1`,
            [plate]
        );
        if (!existing.rows.length) return null;

        const returnedAt = vehicle.entryTime ? new Date(vehicle.entryTime).toISOString() : new Date().toISOString();
        const updated = await pool.query(
            `UPDATE swaps
             SET returnedAt = $1, returnYard = $2, returnVehicleId = $3, returnDetectedBy = $4
             WHERE id = $5
             RETURNING *`,
            [returnedAt, yard, vehicle.id, updatedBy || 'system', existing.rows[0].id]
        );
        const swap = mapSwapRow(updated.rows[0]);
        return buildLoanReturnPayload(swap, vehicle);
    }

    const existing = db.prepare(
        `SELECT * FROM swaps
         WHERE tipo IN ('emprestimo', 'troca')
         AND UPPER(plateOut) = UPPER(?)
         AND returnedAt IS NULL
         ORDER BY date DESC
         LIMIT 1`
    ).get(plate);
    if (!existing) return null;

    const returnedAt = vehicle.entryTime ? new Date(vehicle.entryTime).toISOString() : new Date().toISOString();
    db.prepare(
        `UPDATE swaps
         SET returnedAt = ?, returnYard = ?, returnVehicleId = ?, returnDetectedBy = ?
         WHERE id = ?`
    ).run(returnedAt, yard, vehicle.id, updatedBy || 'system', existing.id);

    const swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(existing.id);
    return buildLoanReturnPayload(mapSwapRow(swap), vehicle);
}

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

app.get('/api/audit-logs', requireAuth, requireRole(['admin']), async (req, res) => {
    const limit = Math.max(10, Math.min(Number.parseInt(req.query.limit, 10) || 100, 500));

    try {
        if (isProduction) {
            const result = await pool.query(
                `SELECT id, entityType, entityId, action, summary, details, username, createdAt
                 FROM audit_logs
                 ORDER BY createdAt DESC
                 LIMIT $1`,
                [limit]
            );
            return res.json(result.rows.map(row => ({
                id: row.id,
                entityType: row.entitytype || row.entityType,
                entityId: row.entityid || row.entityId,
                action: row.action,
                summary: row.summary,
                details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : (row.details || {}),
                username: row.username,
                createdAt: row.createdat || row.createdAt
            })));
        }

        const rows = db.prepare(
            `SELECT id, entityType, entityId, action, summary, details, username, createdAt
             FROM audit_logs
             ORDER BY datetime(createdAt) DESC
             LIMIT ?`
        ).all(limit);
        res.json(rows.map(row => ({
            ...row,
            details: (() => {
                try {
                    return JSON.parse(row.details || '{}');
                } catch (error) {
                    return {};
                }
            })()
        })));
    } catch (error) {
        console.error('Erro ao carregar auditoria:', error);
        res.status(500).json({ error: 'Erro ao carregar auditoria' });
    }
});

app.get('/api/bases', async (req, res) => {
    try {
        res.json(await listBaseOptions());
    } catch (error) {
        console.error('Erro ao listar bases:', error);
        res.status(500).json({ error: 'Erro ao carregar bases' });
    }
});

app.post('/api/bases', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const created = await createMasterDataValue('bases', req.body?.name);
        await recordAuditEvent(req, {
            entityType: 'base',
            entityId: created.id,
            action: 'create',
            summary: `Base cadastrada: ${created.name}`,
            details: created
        });
        res.status(201).json(created);
    } catch (error) {
        console.error('Erro ao cadastrar base:', error);
        const isDuplicate = error.code === 'DUPLICATE' || String(error.message || '').toUpperCase().includes('UNIQUE');
        const isValidation = String(error.message || '').includes('válido');
        res.status(isValidation ? 400 : (isDuplicate ? 409 : 500)).json({ error: isValidation ? error.message : (isDuplicate ? 'Esta base já está cadastrada' : 'Erro ao cadastrar base') });
    }
});

app.get('/api/master-data', requireAuth, requireRole(['admin']), async (req, res) => {
    try {
        const bundle = await listMasterDataBundle();
        res.json({
            meta: Object.fromEntries(Object.entries(MASTER_DATA_CONFIG).map(([key, config]) => [key, { label: config.label }])),
            values: bundle
        });
    } catch (error) {
        console.error('Erro ao carregar cadastros mestres:', error);
        res.status(500).json({ error: 'Erro ao carregar cadastros mestres' });
    }
});

app.post('/api/master-data/:type', requireAuth, requireRole(['admin']), async (req, res) => {
    const type = String(req.params.type || '').trim();
    if (!getMasterDataConfig(type)) return res.status(404).json({ error: 'Tipo de cadastro não encontrado' });

    try {
        const created = await createMasterDataValue(type, req.body?.name);
        await recordAuditEvent(req, {
            entityType: `master-data:${type}`,
            entityId: created.id,
            action: 'create',
            summary: `${MASTER_DATA_CONFIG[type].label}: ${created.name}`,
            details: { type, ...created }
        });
        res.status(201).json(created);
    } catch (error) {
        console.error(`Erro ao cadastrar item mestre (${type}):`, error);
        const isDuplicate = error.code === 'DUPLICATE' || String(error.message || '').toUpperCase().includes('UNIQUE');
        const isValidation = String(error.message || '').includes('válido');
        res.status(isValidation ? 400 : (isDuplicate ? 409 : 500)).json({ error: isValidation ? error.message : (isDuplicate ? 'Este item já está cadastrado' : 'Erro ao cadastrar item') });
    }
});

app.get('/api/occurrences/options', async (req, res) => {
    try {
        const branchOptions = await getOccurrenceBranchOptions();

        if (isProduction) {
            const [tripTypes, lines, plates, vehicleTypes, reasons, subcategories, details] = await Promise.all([
                pool.query('SELECT name FROM occurrence_trip_types ORDER BY name'),
                pool.query('SELECT name FROM occurrence_lines ORDER BY name'),
                pool.query('SELECT name FROM occurrence_plates ORDER BY name'),
                pool.query('SELECT name FROM occurrence_vehicle_types ORDER BY name'),
                pool.query('SELECT name FROM occurrence_reasons ORDER BY name'),
                pool.query('SELECT name FROM occurrence_subcategories ORDER BY name'),
                pool.query('SELECT name FROM occurrence_details ORDER BY name')
            ]);

            return res.json({
                branches: branchOptions,
                tripTypes: tripTypes.rows.map(row => row.name),
                lines: lines.rows.map(row => row.name),
                plates: plates.rows.map(row => row.name),
                vehicleTypes: vehicleTypes.rows.map(row => row.name),
                reasons: reasons.rows.map(row => row.name),
                subcategories: subcategories.rows.map(row => row.name),
                details: details.rows.map(row => row.name)
            });
        }

        res.json({
            branches: branchOptions,
            tripTypes: db.prepare('SELECT name FROM occurrence_trip_types ORDER BY name').all().map(row => row.name),
            lines: db.prepare('SELECT name FROM occurrence_lines ORDER BY name').all().map(row => row.name),
            plates: db.prepare('SELECT name FROM occurrence_plates ORDER BY name').all().map(row => row.name),
            vehicleTypes: db.prepare('SELECT name FROM occurrence_vehicle_types ORDER BY name').all().map(row => row.name),
            reasons: db.prepare('SELECT name FROM occurrence_reasons ORDER BY name').all().map(row => row.name),
            subcategories: db.prepare('SELECT name FROM occurrence_subcategories ORDER BY name').all().map(row => row.name),
            details: db.prepare('SELECT name FROM occurrence_details ORDER BY name').all().map(row => row.name)
        });
    } catch (err) {
        console.error('Erro ao carregar opções de ocorrências:', err);
        res.status(500).json({ error: 'Erro ao carregar opções de ocorrências' });
    }
});

app.get('/api/occurrences', async (req, res) => {
    try {
        if (isProduction) {
            const result = await pool.query('SELECT * FROM occurrences ORDER BY tripDate DESC, tripNumber DESC');
            return res.json(result.rows.map(normalizeOccurrenceRow));
        }

        const rows = db.prepare('SELECT * FROM occurrences ORDER BY tripDate DESC, tripNumber DESC').all();
        res.json(rows.map(normalizeOccurrenceRow));
    } catch (err) {
        console.error('Erro ao listar ocorrências:', err);
        res.status(500).json({ error: 'Erro ao listar ocorrências' });
    }
});

app.post('/api/occurrences', async (req, res) => {
    const parsed = validateOccurrencePayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const data = parsed.value;

    try {
        if (isProduction) {
            const result = await pool.query(
                `INSERT INTO occurrences (tripNumber, tripDate, branch, tripType, line, plate, vehicleType, reason, subcategory, detail, serviceOrder, observation)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 RETURNING *`,
                [data.tripNumber, data.tripDate, data.branch, data.tripType, data.line, data.plate, data.vehicleType, data.reason, data.subcategory, data.detail, data.serviceOrder, data.observation]
            );
            const created = normalizeOccurrenceRow(result.rows[0]);
            await recordAuditEvent(req, {
                entityType: 'occurrence',
                entityId: created.id,
                action: 'create',
                summary: `Ocorrência criada para a viagem ${created.tripNumber}`,
                details: created
            });
            return res.status(201).json(created);
        }

        const info = db.prepare(
            `INSERT INTO occurrences (tripNumber, tripDate, branch, tripType, line, plate, vehicleType, reason, subcategory, detail, serviceOrder, observation)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(data.tripNumber, data.tripDate, data.branch, data.tripType, data.line, data.plate, data.vehicleType, data.reason, data.subcategory, data.detail, data.serviceOrder, data.observation);

        const row = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(info.lastInsertRowid);
        const created = normalizeOccurrenceRow(row);
        await recordAuditEvent(req, {
            entityType: 'occurrence',
            entityId: created.id,
            action: 'create',
            summary: `Ocorrência criada para a viagem ${created.tripNumber}`,
            details: created
        });
        res.status(201).json(created);
    } catch (err) {
        console.error('Erro ao criar ocorrência:', err);
        const status = String(err.message || '').includes('UNIQUE') ? 409 : 500;
        res.status(status).json({ error: status === 409 ? 'Número da viagem já cadastrado' : 'Erro ao criar ocorrência' });
    }
});

app.put('/api/occurrences/:id', async (req, res) => {
    const parsed = validateOccurrencePayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

    const data = parsed.value;

    try {
        if (isProduction) {
            const result = await pool.query(
                `UPDATE occurrences
                 SET tripNumber = $1, tripDate = $2, branch = $3, tripType = $4, line = $5, plate = $6, vehicleType = $7, reason = $8, subcategory = $9, detail = $10, serviceOrder = $11, observation = $12, updatedAt = CURRENT_TIMESTAMP
                 WHERE id = $13
                 RETURNING *`,
                [data.tripNumber, data.tripDate, data.branch, data.tripType, data.line, data.plate, data.vehicleType, data.reason, data.subcategory, data.detail, data.serviceOrder, data.observation, id]
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
            const updated = normalizeOccurrenceRow(result.rows[0]);
            await recordAuditEvent(req, {
                entityType: 'occurrence',
                entityId: updated.id,
                action: 'update',
                summary: `Ocorrência atualizada para a viagem ${updated.tripNumber}`,
                details: updated
            });
            return res.json(updated);
        }

        const info = db.prepare(
            `UPDATE occurrences
             SET tripNumber = ?, tripDate = ?, branch = ?, tripType = ?, line = ?, plate = ?, vehicleType = ?, reason = ?, subcategory = ?, detail = ?, serviceOrder = ?, observation = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`
        ).run(data.tripNumber, data.tripDate, data.branch, data.tripType, data.line, data.plate, data.vehicleType, data.reason, data.subcategory, data.detail, data.serviceOrder, data.observation, id);

        if (!info.changes) return res.status(404).json({ error: 'Ocorrência não encontrada' });
        const row = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
        const updated = normalizeOccurrenceRow(row);
        await recordAuditEvent(req, {
            entityType: 'occurrence',
            entityId: updated.id,
            action: 'update',
            summary: `Ocorrência atualizada para a viagem ${updated.tripNumber}`,
            details: updated
        });
        res.json(updated);
    } catch (err) {
        console.error('Erro ao atualizar ocorrência:', err);
        const status = String(err.message || '').includes('UNIQUE') ? 409 : 500;
        res.status(status).json({ error: status === 409 ? 'Número da viagem já cadastrado' : 'Erro ao atualizar ocorrência' });
    }
});

app.delete('/api/occurrences/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

    try {
        if (isProduction) {
            const result = await pool.query('DELETE FROM occurrences WHERE id = $1 RETURNING *', [id]);
            if (!result.rows.length) return res.status(404).json({ error: 'Ocorrência não encontrada' });
            const removed = normalizeOccurrenceRow(result.rows[0]);
            await recordAuditEvent(req, {
                entityType: 'occurrence',
                entityId: removed.id,
                action: 'delete',
                summary: `Ocorrência excluída da viagem ${removed.tripNumber}`,
                details: removed
            });
            return res.json({ success: true });
        }

        const row = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
        const info = db.prepare('DELETE FROM occurrences WHERE id = ?').run(id);
        if (!info.changes) return res.status(404).json({ error: 'Ocorrência não encontrada' });
        await recordAuditEvent(req, {
            entityType: 'occurrence',
            entityId: id,
            action: 'delete',
            summary: `Ocorrência excluída da viagem ${row?.tripNumber || id}`,
            details: row ? normalizeOccurrenceRow(row) : { id }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir ocorrência:', err);
        res.status(500).json({ error: 'Erro ao excluir ocorrência' });
    }
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
            vehicles = result.rows.map(mapPostgresRow).map(normalizeVehicleRecord);
        } else {
            vehicles = db.prepare('SELECT * FROM vehicles ORDER BY entryTime DESC').all().map(normalizeVehicleRecord);
        }
        vehicles = filterVehiclesByUserYards(vehicles, req.session.user.username);
        res.json(vehicles.map(v => {
            const consistentTimes = getConsistentVehicleTimes(v);
            return {
                ...v,
                ...consistentTimes,
                entryDate: formatDateBR(consistentTimes.entryTime),
                exitDate: consistentTimes.exitTime ? formatDateBR(consistentTimes.exitTime) : null,
                timeInYard: calculateTimeInYard(consistentTimes.entryTime, consistentTimes.exitTime),
                timeReady: consistentTimes.readyTime ? calculateTimeInYard(consistentTimes.readyTime, null) : null,
                canChangeLiberado: canChangeLiberadoStatus(req.session.user)
            };
        }));
    } catch (err) {
        console.error('Erro ao listar veículos:', err);
        res.status(500).json({ error: 'Erro ao buscar veículos' });
    }
});

app.post('/api/vehicles', requireAuth, async (req, res) => {
    const { plate, type, yard, base, baseDestino, manager, chassis, keys, notes, entryDate, entregarDiversos, entregarCorreios, hasAccident, documentIssue, sascarStatus, maintenanceCategory } = req.body;
    const allowedYards = getUserAllowedYards(req.session.user.username);
    if (allowedYards.length > 0 && !allowedYards.includes(yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    if (!plate && !chassis) return res.status(400).json({ error: 'Placa ou Chassi obrigatórios' });
    if (!type || !yard) return res.status(400).json({ error: 'Tipo e pátio obrigatórios' });
    const normalizedType = canonicalizeVehicleType(type);
    const normalizedBase = canonicalizeBaseLocation(base || 'Jaraguá-SP (Nacional)');
    const normalizedBaseDestino = canonicalizeBaseLocation(baseDestino || '');
    const isNewVehicle = normalizeBooleanFlag(req.body?.isNewVehicle);
    const newVehiclePlotagem = isNewVehicle && normalizeBooleanFlag(req.body?.newVehiclePlotagem);
    const newVehicleTesteDrive = isNewVehicle && normalizeBooleanFlag(req.body?.newVehicleTesteDrive);
    const newVehicleAdesivoCorreios = isNewVehicle && normalizeBooleanFlag(req.body?.newVehicleAdesivoCorreios);
    const newVehicleAdesivoPrint = isNewVehicle && normalizeBooleanFlag(req.body?.newVehicleAdesivoPrint);
    const newVehicleMarcacaoPneus = isNewVehicle && normalizeBooleanFlag(req.body?.newVehicleMarcacaoPneus);
    const newVehiclePlataformaCarga = isNewVehicle && normalizeBooleanFlag(req.body?.newVehiclePlataformaCarga);
    const newVehicleForracaoInterna = isNewVehicle && normalizedType === 'Van' && normalizeBooleanFlag(req.body?.newVehicleForracaoInterna);
    const newVehicleNotes = isNewVehicle ? String(req.body?.newVehicleNotes || '').trim() : '';
    const hasNewLine = normalizeBooleanFlag(req.body?.hasNewLine);
    const newLineName = hasNewLine ? String(req.body?.newLineName || '').trim() : '';
    const newLineState = hasNewLine ? String(req.body?.newLineState || '').trim() : '';
    if (hasNewLine && (!newLineName || !newLineState)) return res.status(400).json({ error: 'Preencha o nome e o estado/UF da nova linha' });
    try {
        let createdVehicle;
        if (isProduction) {
            const result = await pool.query(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, keys, notes, isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes, hasNewLine, newLineName, newLineState, entregar_diversos, entregar_correios, hasAccident, documentIssue, sascarStatus, maintenanceCategory, entryTime, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29) RETURNING *`,
                [plate ? plate.toUpperCase() : '', normalizedType, yard, normalizedBase, normalizedBaseDestino, manager || '', chassis || '', keys || '', notes || '', isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes, hasNewLine, newLineName, newLineState, entregarDiversos ? true : false, entregarCorreios ? true : false, hasAccident ? true : false, documentIssue ? true : false, sascarStatus || 'pendente', maintenanceCategory || '', entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), req.session.user.username]);
        createdVehicle = normalizeVehicleRecord(mapPostgresRow(result.rows[0]));
    } else {
            const stmt = db.prepare(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, keys, notes, isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes, hasNewLine, newLineName, newLineState, entregar_diversos, entregar_correios, hasAccident, documentIssue, sascarStatus, maintenanceCategory, entryTime, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const result = stmt.run(plate ? plate.toUpperCase() : '', normalizedType, yard, normalizedBase, normalizedBaseDestino, manager || '', chassis || '', keys || '', notes || '', isNewVehicle ? 1 : 0, newVehiclePlotagem ? 1 : 0, newVehicleTesteDrive ? 1 : 0, newVehicleAdesivoCorreios ? 1 : 0, newVehicleAdesivoPrint ? 1 : 0, newVehicleMarcacaoPneus ? 1 : 0, newVehiclePlataformaCarga ? 1 : 0, newVehicleForracaoInterna ? 1 : 0, newVehicleNotes, hasNewLine ? 1 : 0, newLineName, newLineState, entregarDiversos ? 1 : 0, entregarCorreios ? 1 : 0, hasAccident ? 1 : 0, documentIssue ? 1 : 0, sascarStatus || 'pendente', maintenanceCategory || '', entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(), req.session.user.username);
            createdVehicle = normalizeVehicleRecord({ ...db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid) });
        }
        const loanReturn = await detectLoanReturnOnEntry(createdVehicle, req.session.user.username);
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: createdVehicle.id,
            action: 'create',
            summary: `Veículo ${createdVehicle.plate || createdVehicle.chassis || createdVehicle.id} cadastrado`,
            details: createdVehicle
        });
        res.json({ ...createdVehicle, loanReturn });
    } catch (err) {
        console.error('Erro ao criar veículo:', err);
        res.status(500).json({ error: 'Erro ao criar veículo' });
    }
});

app.put('/api/vehicles/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const canEditDates = req.session.user.role === 'admin' || req.session.user.username?.toLowerCase() === 'bandeirantes' || (req.session.user.yards || []).includes('Pátio Bandeirantes');
    const normalizedUpdatePlate = updates.plate !== undefined ? normalizePlateValue(updates.plate) : null;
    const normalizedUpdateChassis = updates.chassis !== undefined ? String(updates.chassis || '').trim() : null;
    if (updates.yard) {
        const allowedYards = getUserAllowedYards(req.session.user.username);
        if (allowedYards.length > 0 && !allowedYards.includes(updates.yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    }
    const normalizedUpdateType = updates.type ? canonicalizeVehicleType(updates.type) : null;
    const normalizedUpdateBase = updates.base ? canonicalizeBaseLocation(updates.base) : null;
    const normalizedUpdateBaseDestino = updates.baseDestino !== undefined ? canonicalizeBaseLocation(updates.baseDestino) : null;
    const isNewVehicle = normalizeBooleanFlag(updates.isNewVehicle);
    const newVehiclePlotagem = isNewVehicle && normalizeBooleanFlag(updates.newVehiclePlotagem);
    const newVehicleTesteDrive = isNewVehicle && normalizeBooleanFlag(updates.newVehicleTesteDrive);
    const newVehicleAdesivoCorreios = isNewVehicle && normalizeBooleanFlag(updates.newVehicleAdesivoCorreios);
    const newVehicleAdesivoPrint = isNewVehicle && normalizeBooleanFlag(updates.newVehicleAdesivoPrint);
    const newVehicleMarcacaoPneus = isNewVehicle && normalizeBooleanFlag(updates.newVehicleMarcacaoPneus);
    const newVehiclePlataformaCarga = isNewVehicle && normalizeBooleanFlag(updates.newVehiclePlataformaCarga);
    const newVehicleForracaoInterna = isNewVehicle && normalizedUpdateType === 'Van' && normalizeBooleanFlag(updates.newVehicleForracaoInterna);
    const newVehicleNotes = isNewVehicle ? String(updates.newVehicleNotes ?? '').trim() : '';
    const hasNewLine = normalizeBooleanFlag(updates.hasNewLine);
    const newLineName = hasNewLine ? String(updates.newLineName ?? '').trim() : '';
    const newLineState = hasNewLine ? String(updates.newLineState ?? '').trim() : '';
    const normalizedUpdateStatus = updates.status ? canonicalizeVehicleStatus(updates.status) : null;
    const shouldClearTimeline = normalizedUpdateStatus && normalizedUpdateStatus !== 'Liberado';
    if (hasNewLine && (!newLineName || !newLineState)) return res.status(400).json({ error: 'Preencha o nome e o estado/UF da nova linha' });
    try {
        const currentVehicle = isProduction
            ? mapPostgresRow((await pool.query('SELECT * FROM vehicles WHERE id = $1', [id])).rows[0])
            : db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
        if (!currentVehicle) return res.status(404).json({ error: 'Veículo não encontrado' });

        const nextPlate = normalizedUpdatePlate !== null ? normalizedUpdatePlate : normalizePlateValue(currentVehicle.plate);
        const nextChassis = normalizedUpdateChassis !== null ? normalizedUpdateChassis : String(currentVehicle.chassis || '').trim();
        if (!nextPlate && !nextChassis) return res.status(400).json({ error: 'Placa ou Chassi obrigatórios' });

        if (isProduction) {
            await pool.query(`UPDATE vehicles SET plate = COALESCE($1::TEXT, plate), type = COALESCE($2::TEXT, type), yard = COALESCE($3::TEXT, yard), base = COALESCE($4::TEXT, base), baseDestino = COALESCE($5::TEXT, baseDestino), manager = COALESCE($6::TEXT, manager), chassis = COALESCE($7::TEXT, chassis), keys = COALESCE($8::TEXT, keys), status = COALESCE($9::TEXT, status), maintenance = COALESCE($10::BOOLEAN, maintenance), hasAccident = COALESCE($11::BOOLEAN, hasAccident), documentIssue = COALESCE($12::BOOLEAN, documentIssue), sascarStatus = COALESCE($13::TEXT, sascarStatus), maintenanceCategory = COALESCE($14::TEXT, maintenanceCategory), notes = COALESCE($15::TEXT, notes), entregar_diversos = COALESCE($16::BOOLEAN, entregar_diversos), entregar_correios = COALESCE($17::BOOLEAN, entregar_correios), entregue = COALESCE($18::BOOLEAN, entregue), entreguePara = COALESCE($19::TEXT, entreguePara), entryTime = CASE WHEN $20::TEXT IS NOT NULL AND ${canEditDates} THEN $20::TIMESTAMP ELSE entryTime END, exitTime = CASE WHEN ${shouldClearTimeline} THEN NULL WHEN $21::TEXT IS NOT NULL AND ${canEditDates} THEN $21::TIMESTAMP ELSE exitTime END, readyTime = CASE WHEN ${shouldClearTimeline} THEN NULL ELSE readyTime END, isNewVehicle = COALESCE($22::BOOLEAN, isNewVehicle), newVehiclePlotagem = COALESCE($23::BOOLEAN, newVehiclePlotagem), newVehicleTesteDrive = COALESCE($24::BOOLEAN, newVehicleTesteDrive), newVehicleAdesivoCorreios = COALESCE($25::BOOLEAN, newVehicleAdesivoCorreios), newVehicleAdesivoPrint = COALESCE($26::BOOLEAN, newVehicleAdesivoPrint), newVehicleMarcacaoPneus = COALESCE($27::BOOLEAN, newVehicleMarcacaoPneus), newVehiclePlataformaCarga = COALESCE($28::BOOLEAN, newVehiclePlataformaCarga), newVehicleForracaoInterna = COALESCE($29::BOOLEAN, newVehicleForracaoInterna), newVehicleNotes = COALESCE($30::TEXT, newVehicleNotes), hasNewLine = COALESCE($31::BOOLEAN, hasNewLine), newLineName = COALESCE($32::TEXT, newLineName), newLineState = COALESCE($33::TEXT, newLineState), updatedAt = CURRENT_TIMESTAMP, updatedBy = $34::TEXT WHERE id = $35::INTEGER`,
                [nextPlate, normalizedUpdateType, updates.yard || null, normalizedUpdateBase, normalizedUpdateBaseDestino, updates.manager || null, nextChassis, updates.keys || null, normalizedUpdateStatus || null, updates.maintenance !== undefined ? Boolean(updates.maintenance) : null, updates.hasAccident !== undefined ? Boolean(updates.hasAccident) : null, updates.documentIssue !== undefined ? Boolean(updates.documentIssue) : null, updates.sascarStatus || null, updates.maintenanceCategory || null, updates.notes || null, updates.entregarDiversos !== undefined ? Boolean(updates.entregarDiversos) : null, updates.entregarCorreios !== undefined ? Boolean(updates.entregarCorreios) : null, updates.entregue !== undefined ? Boolean(updates.entregue) : null, updates.entreguePara || null, canEditDates && updates.entryTime ? updates.entryTime : null, canEditDates && updates.exitTime ? updates.exitTime : null, isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes ?? null, hasNewLine, newLineName ?? null, newLineState ?? null, req.session.user.username, id]);
        } else {
            const nextEntryTime = canEditDates && updates.entryTime ? updates.entryTime : currentVehicle?.entryTime || null;
            const nextExitTime = shouldClearTimeline ? null : (canEditDates && updates.exitTime ? updates.exitTime : currentVehicle?.exitTime || null);
            const nextReadyTime = shouldClearTimeline ? null : (currentVehicle?.readyTime || null);
            db.prepare(`UPDATE vehicles SET plate = ?, type = ?, yard = ?, base = ?, baseDestino = ?, manager = ?, chassis = ?, keys = ?, status = ?, maintenance = ?, hasAccident = ?, documentIssue = ?, sascarStatus = ?, maintenanceCategory = ?, notes = ?, entregar_diversos = ?, entregar_correios = ?, entregue = ?, entreguePara = ?, readyTime = ?, entryTime = ?, exitTime = ?, isNewVehicle = ?, newVehiclePlotagem = ?, newVehicleTesteDrive = ?, newVehicleAdesivoCorreios = ?, newVehicleAdesivoPrint = ?, newVehicleMarcacaoPneus = ?, newVehiclePlataformaCarga = ?, newVehicleForracaoInterna = ?, newVehicleNotes = ?, hasNewLine = ?, newLineName = ?, newLineState = ?, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
                nextPlate, normalizedUpdateType, updates.yard || null, normalizedUpdateBase, normalizedUpdateBaseDestino, updates.manager || null, nextChassis, updates.keys || null, normalizedUpdateStatus || null,
                updates.maintenance ? 1 : 0, updates.hasAccident ? 1 : 0, updates.documentIssue ? 1 : 0, updates.sascarStatus || 'pendente', updates.maintenanceCategory || '', updates.notes || null,
                updates.entregarDiversos ? 1 : 0, updates.entregarCorreios ? 1 : 0, updates.entregue ? 1 : 0, updates.entreguePara || '',
                nextReadyTime, nextEntryTime, nextExitTime,
                isNewVehicle ? 1 : 0, newVehiclePlotagem ? 1 : 0, newVehicleTesteDrive ? 1 : 0, newVehicleAdesivoCorreios ? 1 : 0, newVehicleAdesivoPrint ? 1 : 0, newVehicleMarcacaoPneus ? 1 : 0, newVehiclePlataformaCarga ? 1 : 0, newVehicleForracaoInterna ? 1 : 0, newVehicleNotes, hasNewLine ? 1 : 0, newLineName, newLineState,
                new Date().toISOString(), req.session.user.username, id);
        }
        const updatedVehicle = isProduction
            ? normalizeVehicleRecord(mapPostgresRow((await pool.query('SELECT * FROM vehicles WHERE id = $1', [id])).rows[0]))
            : normalizeVehicleRecord(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id));
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: id,
            action: 'update',
            summary: `Veículo ${updatedVehicle?.plate || id} atualizado`,
            details: updatedVehicle || { id, updates }
        });
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
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: id,
            action: 'deliver',
            summary: `Veículo ${id} marcado como entregue para ${entreguePara}`,
            details: { entreguePara }
        });
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
    const validStatuses = ['Aguardando linha', 'Aguardando abastecimento', 'Aguardando manutenção', 'Em manutenção', 'Funilaria', 'Borracharia'];
    if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: 'Status inválido' });
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = $1, readyTime = NULL, exitTime = NULL, updatedAt = CURRENT_TIMESTAMP, updatedBy = $2 WHERE id = $3`, [newStatus, req.session.user.username, id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = ?, readyTime = NULL, exitTime = NULL, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(newStatus, new Date().toISOString(), req.session.user.username, id);
        }
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: id,
            action: 'undo-liberado',
            summary: `Liberação desfeita para o veículo ${id}`,
            details: { newStatus }
        });
        res.json({ success: true, message: 'Liberação desfeita com sucesso' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao desfazer liberação: ' + err.message });
    }
});

app.put('/api/vehicles/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['Aguardando linha', 'Aguardando abastecimento', 'Aguardando manutenção', 'Em manutenção', 'Funilaria', 'Borracharia', 'Liberado', 'Sinistro'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    try {
        if (isProduction) {
            await pool.query(`UPDATE vehicles SET status = $1, maintenance = $2, updatedAt = CURRENT_TIMESTAMP WHERE id = $3`, [status, status === 'Em manutenção' || status === 'Funilaria' || status === 'Borracharia', id]);
        } else {
            db.prepare(`UPDATE vehicles SET status = ?, maintenance = ?, updatedAt = ? WHERE id = ?`).run(status, (status === 'Em manutenção' || status === 'Funilaria' || status === 'Borracharia') ? 1 : 0, new Date().toISOString(), id);
        }
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: id,
            action: 'status',
            summary: `Status do veículo ${id} alterado para ${status}`,
            details: { status }
        });
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
        await recordAuditEvent(req, {
            entityType: 'vehicle',
            entityId: id,
            action: 'exit',
            summary: `Saída registrada para o veículo ${id}`,
            details: { status: 'Liberado' }
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao registrar saída' }); }
});

app.delete('/api/vehicles/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            const result = await pool.query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [id]);
            const removed = result.rows[0] ? normalizeVehicleRecord(mapPostgresRow(result.rows[0])) : null;
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'vehicle',
                    entityId: id,
                    action: 'delete',
                    summary: `Veículo ${removed.plate || id} excluído`,
                    details: removed
                });
            }
        } else {
            const removed = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
            db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'vehicle',
                    entityId: id,
                    action: 'delete',
                    summary: `Veículo ${removed.plate || id} excluído`,
                    details: normalizeVehicleRecord(removed)
                });
            }
        }
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
            swaps = db.prepare('SELECT * FROM swaps ORDER BY date DESC LIMIT 100').all().map(mapSwapRow);
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
                [date ? new Date(date).toISOString() : new Date().toISOString(), normalizePlateValue(plateIn) || '0000', normalizePlateValue(plateOut) || '0000', base || '', baseDestino || '', notes || '', tipo || 'troca', req.session.user.username]);
            swapResult = mapSwapRow(result.rows[0]);
        } else {
            const stmt = db.prepare(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            const result = stmt.run(date ? new Date(date).toISOString() : new Date().toISOString(), normalizePlateValue(plateIn) || '0000', normalizePlateValue(plateOut) || '0000', base || '', baseDestino || '', notes || '', tipo || 'troca', req.session.user.username);
            swapResult = mapSwapRow(db.prepare('SELECT * FROM swaps WHERE id = ?').get(result.lastInsertRowid));
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
        await recordAuditEvent(req, {
            entityType: 'swap',
            entityId: swapResult.id,
            action: 'create',
            summary: `${swapResult.tipo === 'emprestimo' ? 'Empréstimo' : 'Troca'} registrada para ${swapResult.plateOut}`,
            details: { ...swapResult, vehicleMarkedAsEntregue }
        });
        
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
        const shouldResetReturn = updates.tipo && !['emprestimo', 'troca'].includes(updates.tipo);
        if (isProduction) {
            await pool.query(
                `UPDATE swaps
                 SET date = COALESCE($1, date),
                     plateIn = COALESCE($2, plateIn),
                     plateOut = COALESCE($3, plateOut),
                     base = COALESCE($4, base),
                     baseDestino = COALESCE($5, baseDestino),
                     notes = COALESCE($6, notes),
                     tipo = COALESCE($7, tipo),
                     returnedAt = CASE WHEN $8 THEN NULL ELSE returnedAt END,
                     returnYard = CASE WHEN $8 THEN '' ELSE returnYard END,
                     returnVehicleId = CASE WHEN $8 THEN NULL ELSE returnVehicleId END,
                     returnDetectedBy = CASE WHEN $8 THEN '' ELSE returnDetectedBy END
                 WHERE id = $9`,
                [updates.date ? new Date(updates.date).toISOString() : null, normalizePlateValue(updates.plateIn) || '0000', normalizePlateValue(updates.plateOut) || null, updates.base, updates.baseDestino || null, updates.notes, updates.tipo, shouldResetReturn, id]
            );
        } else {
            db.prepare(
                `UPDATE swaps
                 SET date = ?, plateIn = ?, plateOut = ?, base = ?, baseDestino = ?, notes = ?, tipo = ?,
                     returnedAt = CASE WHEN ? THEN NULL ELSE returnedAt END,
                     returnYard = CASE WHEN ? THEN '' ELSE returnYard END,
                     returnVehicleId = CASE WHEN ? THEN NULL ELSE returnVehicleId END,
                     returnDetectedBy = CASE WHEN ? THEN '' ELSE returnDetectedBy END
                 WHERE id = ?`
            ).run(
                updates.date ? new Date(updates.date).toISOString() : null,
                normalizePlateValue(updates.plateIn) || '0000',
                normalizePlateValue(updates.plateOut) || null,
                updates.base,
                updates.baseDestino || null,
                updates.notes,
                updates.tipo || 'troca',
                shouldResetReturn ? 1 : 0,
                shouldResetReturn ? 1 : 0,
                shouldResetReturn ? 1 : 0,
                shouldResetReturn ? 1 : 0,
                id
            );
        }
        const updatedSwap = isProduction
            ? mapSwapRow((await pool.query('SELECT * FROM swaps WHERE id = $1', [id])).rows[0])
            : mapSwapRow(db.prepare('SELECT * FROM swaps WHERE id = ?').get(id));
        await recordAuditEvent(req, {
            entityType: 'swap',
            entityId: id,
            action: 'update',
            summary: `${updatedSwap?.tipo === 'emprestimo' ? 'Empréstimo' : 'Troca'} ${id} atualizado`,
            details: updatedSwap || { id, updates }
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

app.delete('/api/swaps/:id', requireAuth, requireRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            const result = await pool.query('DELETE FROM swaps WHERE id = $1 RETURNING *', [id]);
            const removed = result.rows[0] ? mapSwapRow(result.rows[0]) : null;
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'swap',
                    entityId: id,
                    action: 'delete',
                    summary: `${removed.tipo === 'emprestimo' ? 'Empréstimo' : 'Troca'} ${id} excluído`,
                    details: removed
                });
            }
        }
        else {
            const removed = db.prepare('SELECT * FROM swaps WHERE id = ?').get(id);
            db.prepare('DELETE FROM swaps WHERE id = ?').run(id);
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'swap',
                    entityId: id,
                    action: 'delete',
                    summary: `${removed.tipo === 'emprestimo' ? 'Empréstimo' : 'Troca'} ${id} excluído`,
                    details: mapSwapRow(removed)
                });
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro ao deletar' }); }
});

app.get('/api/conjuntos', requireAuth, async (req, res) => {
    try {
        let conjuntos;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM conjuntos ORDER BY date DESC LIMIT 200');
            conjuntos = result.rows.map(mapConjuntoRow);
        } else {
            conjuntos = db.prepare('SELECT * FROM conjuntos ORDER BY date DESC LIMIT 200').all();
        }
        conjuntos = filterConjuntosByUserYards(conjuntos, req.session.user.username);
        res.json(conjuntos.map(c => ({ ...c, dateFormatted: formatDateBR(c.date) })));
    } catch (err) {
        console.error('Erro ao buscar conjuntos:', err);
        res.status(500).json({ error: 'Erro ao buscar conjuntos' });
    }
});

app.post('/api/conjuntos', requireAuth, async (req, res) => {
    const { date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes } = req.body;
    const allowedYards = getUserAllowedYards(req.session.user.username);
    if (allowedYards.length > 0 && yard && !allowedYards.includes(yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    if (!cavaloPlate || !carretaPlate) return res.status(400).json({ error: 'Cavalo e carreta são obrigatórios' });
    try {
        let createdConjunto = null;
        if (isProduction) {
            const result = await pool.query(`INSERT INTO conjuntos (date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes, updatedBy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [date ? new Date(date).toISOString() : new Date().toISOString(), cavaloPlate.toUpperCase(), carretaPlate.toUpperCase(), yard || '', base || '', baseDestino || '', leaderName || '', notes || '', req.session.user.username]);
            createdConjunto = mapConjuntoRow(result.rows[0]);
        } else {
            const result = db.prepare(`INSERT INTO conjuntos (date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes, updatedBy) VALUES (?,?,?,?,?,?,?,?,?)`)
                .run(date ? new Date(date).toISOString() : new Date().toISOString(), cavaloPlate.toUpperCase(), carretaPlate.toUpperCase(), yard || '', base || '', baseDestino || '', leaderName || '', notes || '', req.session.user.username);
            createdConjunto = mapConjuntoRow(db.prepare('SELECT * FROM conjuntos WHERE id = ?').get(result.lastInsertRowid));
        }
        await recordAuditEvent(req, {
            entityType: 'conjunto',
            entityId: createdConjunto?.id || '',
            action: 'create',
            summary: `Conjunto ${cavaloPlate.toUpperCase()} + ${carretaPlate.toUpperCase()} criado`,
            details: createdConjunto || { cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao criar conjunto:', err);
        res.status(500).json({ error: 'Erro ao montar conjunto: ' + err.message });
    }
});

app.put('/api/conjuntos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes } = req.body;
    const allowedYards = getUserAllowedYards(req.session.user.username);
    if (allowedYards.length > 0 && yard && !allowedYards.includes(yard)) return res.status(403).json({ error: 'Você não tem permissão para este pátio' });
    try {
        if (isProduction) {
            await pool.query(`UPDATE conjuntos SET date = COALESCE($1, date), cavaloPlate = COALESCE($2, cavaloPlate), carretaPlate = COALESCE($3, carretaPlate), yard = COALESCE($4, yard), base = COALESCE($5, base), baseDestino = COALESCE($6, baseDestino), leaderName = COALESCE($7, leaderName), notes = COALESCE($8, notes), updatedBy = $9 WHERE id = $10`,
                [date ? new Date(date).toISOString() : null, cavaloPlate ? cavaloPlate.toUpperCase() : null, carretaPlate ? carretaPlate.toUpperCase() : null, yard || null, base || null, baseDestino || null, leaderName || null, notes || null, req.session.user.username, id]);
        } else {
            db.prepare(`UPDATE conjuntos SET date = ?, cavaloPlate = ?, carretaPlate = ?, yard = ?, base = ?, baseDestino = ?, leaderName = ?, notes = ?, updatedBy = ? WHERE id = ?`)
                .run(date ? new Date(date).toISOString() : null, cavaloPlate ? cavaloPlate.toUpperCase() : null, carretaPlate ? carretaPlate.toUpperCase() : null, yard || null, base || null, baseDestino || null, leaderName || null, notes || null, req.session.user.username, id);
        }
        const updatedConjunto = isProduction
            ? mapConjuntoRow((await pool.query('SELECT * FROM conjuntos WHERE id = $1', [id])).rows[0])
            : mapConjuntoRow(db.prepare('SELECT * FROM conjuntos WHERE id = ?').get(id));
        await recordAuditEvent(req, {
            entityType: 'conjunto',
            entityId: id,
            action: 'update',
            summary: `Conjunto ${id} atualizado`,
            details: updatedConjunto || { id, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao atualizar conjunto:', err);
        res.status(500).json({ error: 'Erro ao atualizar conjunto: ' + err.message });
    }
});

app.delete('/api/conjuntos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        if (isProduction) {
            const result = await pool.query('DELETE FROM conjuntos WHERE id = $1 RETURNING *', [id]);
            const removed = result.rows[0] ? mapConjuntoRow(result.rows[0]) : null;
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'conjunto',
                    entityId: id,
                    action: 'delete',
                    summary: `Conjunto ${id} desmontado`,
                    details: removed
                });
            }
        }
        else {
            const removed = db.prepare('SELECT * FROM conjuntos WHERE id = ?').get(id);
            db.prepare('DELETE FROM conjuntos WHERE id = ?').run(id);
            if (removed) {
                await recordAuditEvent(req, {
                    entityType: 'conjunto',
                    entityId: id,
                    action: 'delete',
                    summary: `Conjunto ${id} desmontado`,
                    details: mapConjuntoRow(removed)
                });
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao desmontar conjunto:', err);
        res.status(500).json({ error: 'Erro ao desmontar conjunto' });
    }
});

app.get('/api/management/dashboard', requireAuth, async (req, res) => {
    try {
        let allVehicles;
        if (isProduction) {
            const result = await pool.query('SELECT * FROM vehicles');
            allVehicles = result.rows.map(mapPostgresRow).map(normalizeVehicleRecord);
        } else {
            allVehicles = db.prepare('SELECT * FROM vehicles').all().map(normalizeVehicleRecord);
        }
        const vehicles = filterVehiclesByUserYards(allVehicles, req.session.user.username);
        const now = new Date();
        const readyVehicles = vehicles.filter(v => v.status === 'Liberado');
        const sascarPendente = vehicles.filter(v => v.sascarStatus === 'pendente').length;
        const sascarManutencao = vehicles.filter(v => v.sascarStatus === 'manutencao').length;
        const sascarInstalado = vehicles.filter(v => v.sascarStatus === 'instalado').length;
        const maintenanceByCategory = {
            funilaria: vehicles.filter(v => v.maintenance && v.maintenanceCategory === 'funilaria').length,
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
        let allVehicles, allConjuntos;
        if (isProduction) {
            const vehicleResult = await pool.query('SELECT * FROM vehicles');
            allVehicles = vehicleResult.rows.map(mapPostgresRow).map(normalizeVehicleRecord);
            const conjuntosResult = await pool.query('SELECT * FROM conjuntos');
            allConjuntos = conjuntosResult.rows.map(mapConjuntoRow);
        } else {
            allVehicles = db.prepare('SELECT * FROM vehicles').all().map(normalizeVehicleRecord);
            allConjuntos = db.prepare('SELECT * FROM conjuntos').all();
        }
        const vehicles = filterVehiclesByUserYards(allVehicles, req.session.user.username);
        const conjuntos = filterConjuntosByUserYards(allConjuntos, req.session.user.username);
        const active = vehicles.filter(v => v.status !== 'Liberado');
        const liberated = vehicles.filter(v => v.status === 'Liberado');
        const entreguesDiversos = vehicles.filter(v => v.entregarDiversos).length;
        const entreguesCorreios = vehicles.filter(v => v.entregarCorreios).length;
        const comSinistro = vehicles.filter(v => v.hasAccident).length;
        const veiculosNovos = vehicles.filter(v => v.isNewVehicle).length;
        const now = new Date();
        const stalledVehicles = active.filter(v => (now - new Date(v.entryTime)) / (1000 * 60 * 60) > 24);
        const readyForBoarding = liberated.filter(v => !v.entregue).length;
        const sascarIssues = vehicles.filter(v => ['pendente', 'manutencao'].includes(v.sascarStatus)).length;
        const documentationIssues = vehicles.filter(v => v.documentIssue).length;
        const maintenanceOrAccident = vehicles.filter(v => v.status === 'Em manutenção' || v.status === 'Funilaria' || v.status === 'Borracharia' || v.maintenance || v.hasAccident).length;
        res.json({
            cavalosMecanicos: active.filter(v => v.type === 'Cavalo Mecânico').length,
            carretas: active.filter(v => v.type === 'Carreta').length,
            conjuntosMontados: conjuntos.length,
            emManutencao: active.filter(v => v.status === 'Em manutenção').length,
            emFunilaria: active.filter(v => v.status === 'Funilaria').length,
            emBorracharia: active.filter(v => v.status === 'Borracharia').length,
            liberados: liberated.length,
            entreguesDiversos,
            entreguesCorreios,
            comSinistro,
            veiculosNovos,
            readyForBoarding,
            sascarIssues,
            documentationIssues,
            maintenanceOrAccident,
            totalAtivos: active.length,
            totalGeral: active.length + liberated.length,
            stalledVehicles: stalledVehicles.length,
            stalledVehiclesList: stalledVehicles
                .map(v => ({
                    id: v.id,
                    plate: v.plate,
                    type: v.type,
                    yard: v.yard,
                    status: v.status,
                    entryTime: v.entryTime,
                    entryDate: v.entryDate,
                    timeInYard: v.timeInYard,
                    hours: Math.round((now - new Date(v.entryTime)) / (1000 * 60 * 60))
                }))
                .sort((a, b) => b.hours - a.hours),
            lastUpdated: new Date().toISOString()
        });
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar estatísticas' }); }
});

async function buildExportPayload(exportedBy = 'system') {
    let vehicles, swaps, conjuntos;
    if (isProduction) {
        vehicles = (await pool.query('SELECT * FROM vehicles')).rows.map(mapPostgresRow);
        swaps = (await pool.query('SELECT * FROM swaps')).rows.map(mapSwapRow);
        conjuntos = (await pool.query('SELECT * FROM conjuntos')).rows.map(mapConjuntoRow);
    } else {
        vehicles = db.prepare('SELECT * FROM vehicles').all();
        swaps = db.prepare('SELECT * FROM swaps').all();
        conjuntos = db.prepare('SELECT * FROM conjuntos').all();
    }
    return {
        vehicles,
        swaps,
        conjuntos,
        exportedAt: new Date().toISOString(),
        version: '6.0.0',
        exportedBy
    };
}

async function createPreImportBackup(exportedBy = 'system') {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupFile = `backup-pre-import-${Date.now()}.json`;
    const backupPath = path.join(backupDir, backupFile);
    const payload = await buildExportPayload(exportedBy);
    fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8');
    return { backupFile, backupPath };
}

app.post('/api/import', requireAuth, requireRole(['admin']), async (req, res) => {
    const importedVehiclesRaw = Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
    const importedSwapsRaw = resolveImportedSwaps(req.body);
    const importedConjuntosRaw = resolveImportedConjuntos(req.body);
    if (!Array.isArray(importedVehiclesRaw)) return res.status(400).json({ error: 'Dados devem conter: {"vehicles": [...]} ' });

    const importedVehicles = importedVehiclesRaw
        .map(normalizeImportedVehicle)
        .filter(v => v && (v.plate || v.chassis));

    const importedSwaps = importedSwapsRaw
        .map(normalizeImportedSwap)
        .filter(s => s && s.plateOut);

    const importedConjuntos = importedConjuntosRaw
        .map(normalizeImportedConjunto)
        .filter(c => c && c.cavaloPlate && c.carretaPlate);

    if (importedVehicles.length === 0 && importedSwaps.length === 0 && importedConjuntos.length === 0) {
        return res.status(400).json({ error: 'Arquivo de importação vazio ou sem registros válidos. Nenhum dado foi alterado.' });
    }

    try {
        const backup = await createPreImportBackup(req.session.user.username);
        if (isProduction) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('DELETE FROM vehicles');
                await client.query('DELETE FROM swaps');
                await client.query('DELETE FROM conjuntos');
                for (const v of importedVehicles) {
                    if (v.plate || v.chassis) {
                        await client.query(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, status, maintenance, maintenanceCategory, hasAccident, documentIssue, sascarStatus, keys, notes, isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes, hasNewLine, newLineName, newLineState, entregar_diversos, entregar_correios, entregue, entreguePara, readyTime, entryTime, exitTime, updatedBy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)`,
                            [v.plate ? v.plate.toUpperCase() : '', v.type, v.yard, v.base || 'Jaraguá-SP (Nacional)', v.baseDestino || '', v.manager || '', v.chassis || '', v.status || 'Aguardando linha', v.maintenance || false, v.maintenanceCategory || '', v.hasAccident || false, v.documentIssue || false, v.sascarStatus || 'pendente', v.keys || '', v.notes || '', v.isNewVehicle || false, v.newVehiclePlotagem || false, v.newVehicleTesteDrive || false, v.newVehicleAdesivoCorreios || false, v.newVehicleAdesivoPrint || false, v.newVehicleMarcacaoPneus || false, v.newVehiclePlataformaCarga || false, v.newVehicleForracaoInterna || false, v.newVehicleNotes || '', v.hasNewLine || false, v.newLineName || '', v.newLineState || '', v.entregarDiversos || false, v.entregarCorreios || false, v.entregue || false, v.entreguePara || '', v.readyTime || null, v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username]);
                    }
                }
                if (Array.isArray(importedSwaps) && importedSwaps.length > 0) {
                    for (const s of importedSwaps) {
                        if (s.plateOut) {
                            await client.query(
                                `INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, returnedAt, returnYard, returnVehicleId, returnDetectedBy, updatedBy)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                                [s.date || new Date().toISOString(), s.plateIn || '0000', s.plateOut, s.base || '', s.baseDestino || '', s.notes || '', s.tipo || 'troca', s.returnedAt || null, s.returnYard || '', s.returnVehicleId || null, s.returnDetectedBy || '', req.session.user.username]
                            );
                        }
                    }
                }
                if (Array.isArray(importedConjuntos) && importedConjuntos.length > 0) {
                    for (const c of importedConjuntos) {
                        await client.query(`INSERT INTO conjuntos (date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes, updatedBy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                            [c.date || new Date().toISOString(), c.cavaloPlate.toUpperCase(), c.carretaPlate.toUpperCase(), c.yard || '', c.base || '', c.baseDestino || '', c.leaderName || '', c.notes || '', req.session.user.username]);
                    }
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } else {
            const vehicleStmt = db.prepare(`INSERT INTO vehicles (plate, type, yard, base, baseDestino, manager, chassis, status, maintenance, maintenanceCategory, hasAccident, documentIssue, sascarStatus, keys, notes, isNewVehicle, newVehiclePlotagem, newVehicleTesteDrive, newVehicleAdesivoCorreios, newVehicleAdesivoPrint, newVehicleMarcacaoPneus, newVehiclePlataformaCarga, newVehicleForracaoInterna, newVehicleNotes, hasNewLine, newLineName, newLineState, entregar_diversos, entregar_correios, entregue, entreguePara, readyTime, entryTime, exitTime, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const runSqliteImport = db.transaction(() => {
                db.exec('DELETE FROM vehicles');
                db.exec('DELETE FROM swaps');
                db.exec('DELETE FROM conjuntos');
                db.exec("DELETE FROM sqlite_sequence WHERE name='vehicles'");
                db.exec("DELETE FROM sqlite_sequence WHERE name='swaps'");
                db.exec("DELETE FROM sqlite_sequence WHERE name='conjuntos'");
                for (const v of importedVehicles) {
                    if (v.plate || v.chassis) {
                        vehicleStmt.run(v.plate ? v.plate.toUpperCase() : '', v.type, v.yard, v.base || 'Jaraguá-SP (Nacional)', v.baseDestino || '', v.manager || '', v.chassis || '', v.status || 'Aguardando linha', v.maintenance ? 1 : 0, v.maintenanceCategory || '', v.hasAccident ? 1 : 0, v.documentIssue ? 1 : 0, v.sascarStatus || 'pendente', v.keys || '', v.notes || '', v.isNewVehicle ? 1 : 0, v.newVehiclePlotagem ? 1 : 0, v.newVehicleTesteDrive ? 1 : 0, v.newVehicleAdesivoCorreios ? 1 : 0, v.newVehicleAdesivoPrint ? 1 : 0, v.newVehicleMarcacaoPneus ? 1 : 0, v.newVehiclePlataformaCarga ? 1 : 0, v.newVehicleForracaoInterna ? 1 : 0, v.newVehicleNotes || '', v.hasNewLine ? 1 : 0, v.newLineName || '', v.newLineState || '', v.entregarDiversos ? 1 : 0, v.entregarCorreios ? 1 : 0, v.entregue ? 1 : 0, v.entreguePara || '', v.readyTime || null, v.entryTime || new Date().toISOString(), v.exitTime || null, req.session.user.username);
                    }
                }
                if (Array.isArray(importedSwaps) && importedSwaps.length > 0) {
                const swapStmt = db.prepare(`INSERT INTO swaps (date, plateIn, plateOut, base, baseDestino, notes, tipo, returnedAt, returnYard, returnVehicleId, returnDetectedBy, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                    for (const s of importedSwaps) {
                        if (s.plateOut) {
                            swapStmt.run(s.date || new Date().toISOString(), s.plateIn || '0000', s.plateOut, s.base || '', s.baseDestino || '', s.notes || '', s.tipo || 'troca', s.returnedAt || null, s.returnYard || '', s.returnVehicleId || null, s.returnDetectedBy || '', req.session.user.username);
                        }
                    }
                }
                if (Array.isArray(importedConjuntos) && importedConjuntos.length > 0) {
                    const conjuntoStmt = db.prepare(`INSERT INTO conjuntos (date, cavaloPlate, carretaPlate, yard, base, baseDestino, leaderName, notes, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                    for (const c of importedConjuntos) {
                        conjuntoStmt.run(c.date || new Date().toISOString(), c.cavaloPlate.toUpperCase(), c.carretaPlate.toUpperCase(), c.yard || '', c.base || '', c.baseDestino || '', c.leaderName || '', c.notes || '', req.session.user.username);
                    }
                }
            });
            runSqliteImport();
        }
        const swapsCount = Array.isArray(importedSwaps) ? importedSwaps.length : 0;
        const conjuntosCount = Array.isArray(importedConjuntos) ? importedConjuntos.length : 0;
        res.json({ success: true, imported: importedVehicles.length, swapsImported: swapsCount, conjuntosImported: conjuntosCount, backupFile: backup.backupFile, message: `✅ Importação concluída: ${importedVehicles.length} veículo(s), ${swapsCount} troca(s) e ${conjuntosCount} conjunto(s). Backup salvo em ${backup.backupFile}` });
    } catch (err) {
        console.error('❌ Erro ao importar:', err);
        res.status(500).json({ error: 'Erro ao importar: ' + err.message });
    }
});

app.get('/api/export', requireAuth, async (req, res) => {
    try {
        res.json(await buildExportPayload(req.session.user.username));
    } catch (err) { res.status(500).json({ error: 'Erro ao exportar' }); }
});

function formatDateBR(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function calculateTimeInYard(entryTime, exitTime) {
    const start = new Date(entryTime);
    const end = exitTime ? new Date(exitTime) : new Date();
    const diffMs = Math.max(0, end - start);
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

