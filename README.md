# 🚚 Controle de Pátio - Transportadora Print

Sistema de controle de pátio para gestão de veículos, desenvolvido por **Ramalho Sistemas e Software**.

## 📋 Funcionalidades

- ✅ Cadastro de veículos com OCR de placa
- ✅ Controle de status (Linha, Abastecimento, Manutenção, Borracharia, Liberado)
- ✅ Registro de trocas/empréstimos de veículos
- ✅ Dashboard com gráficos em tempo real
- ✅ Exportação para JSON, Excel e PDF
- ✅ Login com permissões por pátio
- ✅ Compatível com SQLite (local) e PostgreSQL (produção)

## 👥 Usuários Padrão

| Usuário | Senha | Permissões |
|---------|-------|-----------|
| `admin` | `Print@2026` | Todos os pátios |
| `cajamar` | `Cajamar2026` | Apenas Pátio Cajamar |
| `bandeirantes` | `Bandeirantes2026` | Apenas Pátio Bandeirantes |
| `jaragua` | `Jaragua2026` | Pátio Jaraguá + Superior |

## 🚀 Instalação Local

```bash
# 1. Clonar repositório
git clone https://github.com/Print-sp/controle-patio-print.git
cd controle-patio-print

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente (copiar .env.example)
cp .env.example .env

# 4. Iniciar servidor
npm start

# 5. Acessar em: http://localhost:3000