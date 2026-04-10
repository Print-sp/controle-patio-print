# Seguranca e restauracao de dados

Este guia resume o fluxo seguro para trabalhar no sistema sem perder informacoes.

## O que o sistema faz automaticamente

- Antes de cada importacao via API, o sistema cria um backup JSON do estado atual.
- Antes de cada importacao via API, o sistema tambem cria um snapshot completo.
- O snapshot completo inclui banco SQLite local, uploads em `public/uploads` e copias dos backups JSON existentes.

## Comandos principais

- `npm run backup:inspect`
  Valida os arquivos `backup-pre-import-*.json` da pasta `backups` e mostra quantidades encontradas.

- `npm run backup:list`
  Lista os snapshots completos salvos em `backups/snapshots`.

- `npm run backup:snapshot -- --label antes-de-mudar`
  Cria manualmente um snapshot completo antes de manutencao, refatoracao ou importacao sensivel.

- `npm run backup:restore -- --snapshot NOME_DO_SNAPSHOT`
  Executa uma simulacao da restauracao sem alterar nada.

- `npm run backup:restore -- --snapshot NOME_DO_SNAPSHOT --apply`
  Restaura banco e uploads do snapshot escolhido.

## Fluxo recomendado antes de mudancas maiores

1. Rodar `npm run backup:inspect`
2. Rodar `npm run backup:list`
3. Criar um snapshot manual com `npm run backup:snapshot -- --label antes-da-alteracao`
4. So depois iniciar importacao, ajuste estrutural ou limpeza de dados

## Fluxo recomendado para restaurar

1. Parar o servidor
2. Rodar `npm run backup:restore -- --snapshot NOME_DO_SNAPSHOT`
3. Conferir se o plano mostrado esta correto
4. Rodar novamente com `--apply`
5. Reiniciar o servidor

## Onde olhar em caso de duvida

- Snapshots completos: `backups/snapshots`
- Backups JSON de importacao: `backups`
- Banco local atual: `database/patio.db`
- Uploads atuais: `public/uploads`

## Observacao importante

O comando de restauracao sobrescreve o banco local e a pasta de uploads com o conteudo do snapshot escolhido. Por isso, ele cria automaticamente um snapshot `pre-restore` antes de aplicar a restauracao.
