# Relógios de Ponto — Documentação

Integração completa com equipamentos de controle de acesso/ponto (Control ID, Henry, etc.)
e com o sistema de coleta local que roda na rede interna do cliente.

---

## Tabelas do banco

### `relogios_ponto`
Cadastro dos equipamentos.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | — |
| `empresa_id` | INT FK | Multi-tenancy |
| `filial_id` | INT FK NULL | Filial onde o relógio está instalado |
| `numero_serie` | VARCHAR(100) | Identificador único do equipamento (UNIQUE por empresa) |
| `descricao` | VARCHAR(200) | Nome amigável (ex: "Recepção principal") |
| `modelo` | ENUM | Ver tabela de modelos abaixo |
| `ip` | VARCHAR(45) | IP na rede local do cliente (NULL para AFD) |
| `porta` | SMALLINT | Porta TCP (padrão 80; NULL para AFD) |
| `usuario` | VARCHAR(100) | Usuário de acesso ao equipamento |
| `senha` | VARCHAR(100) | Senha de acesso ao equipamento |
| `usa_afd` | TINYINT(1) | 1 = coleta via arquivo AFD (pen drive), 0 = rede TCP/IP |
| `ativo` | TINYINT(1) | 1 = ativo |

### `relogio_sync_fila`
Fila de sincronização de funcionários nos equipamentos.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | — |
| `relogio_id` | INT FK | Relógio de destino |
| `funcionario_id` | INT FK | Funcionário a enviar |
| `operacao` | ENUM | `inserir` / `atualizar` / `excluir` |
| `status` | ENUM | `pendente` / `enviado` / `erro` |
| `tentativas` | SMALLINT | Contador de tentativas |
| `erro_msg` | TEXT | Último erro retornado pelo equipamento |
| `criado_em` | DATETIME | — |
| `atualizado_em` | DATETIME | — |
| `processado_em` | DATETIME | Quando o sistema local confirmou |

> UNIQUE em `(relogio_id, funcionario_id)` — apenas um registro ativo por par.
> Ao enfileirar novamente, o status volta para `pendente` via `ON DUPLICATE KEY UPDATE`.

### `relogio_sistema_saude`
Heartbeat enviado pelo sistema de coleta local.

| Coluna | Tipo | Descrição |
|---|---|---|
| `empresa_id` | INT PK/FK | Um registro por empresa |
| `versao` | VARCHAR(50) | Versão do sistema de coleta |
| `status` | VARCHAR(30) | `online` / `offline` / etc. |
| `ultimo_sync` | DATETIME | Último ciclo de sincronização concluído |
| `relogios` | LONGTEXT | JSON: status por equipamento |
| `recebido_em` | DATETIME | Timestamp do último heartbeat recebido |

---

## Modelos de equipamento

| Valor (DB) | Label | Coleta | Chave do funcionário |
|---|---|---|---|
| `arquivo_afd` | Arquivo AFD | Pen drive | PIS |
| `arquivo_afd_671` | Arquivo AFD 671 | Pen drive | CPF |
| `control_id` | Control ID | TCP/IP | PIS |
| `control_id_class` | Control ID Class | TCP/IP | PIS |
| `control_id_class_671` | Control ID Class 671 | TCP/IP | CPF |
| `henry_super_facil` | Henry Super Fácil | TCP/IP | PIS |
| `henry_sf_advanced` | Henry SF Advanced | TCP/IP | PIS |
| `idface_671` | iDFace 671 | TCP/IP | CPF |
| `henry_1510` | Henry 1510 | TCP/IP | PIS |

> Modelos terminados em `_671` usam **CPF** como chave primária do funcionário.
> Os demais usam **PIS**.

---

## Rotas da API

### Autenticação
Todos os endpoints exigem `Authorization: Bearer <token>` com role `admin`.

```
POST /api/auth/login
{ "email": "...", "senha": "..." }
→ { "accessToken": "...", "refreshToken": "..." }
```

---

### Cadastro de relógios

```
GET    /api/relogios               Lista todos os relógios da empresa
GET    /api/relogios/:id           Detalhe de um relógio
POST   /api/relogios               Cadastrar relógio
PUT    /api/relogios/:id           Editar relógio
DELETE /api/relogios/:id           Remover relógio
```

**POST/PUT body:**
```json
{
  "numero_serie": "1234567890",
  "descricao": "Recepção principal",
  "modelo": "control_id",
  "ip": "192.168.1.100",
  "porta": 80,
  "usuario": "admin",
  "senha": "senha123",
  "usa_afd": false,
  "filial_id": null,
  "ativo": true
}
```

---

### Sistema de coleta local (polling)

```
GET  /api/relogios/sync
```
Lista todos os relógios ativos da empresa (para o sistema local saber quais gerenciar).

```
GET  /api/relogios/fila?relogio_id=X
```
Retorna funcionários pendentes para o relógio `X`. O sistema local chama isso no polling.

**Resposta:**
```json
{
  "data": [
    {
      "fila_id": 42,
      "funcionario_id": 7,
      "operacao": "inserir",
      "tentativas": 0,
      "nome": "João Silva",
      "cpf": "12345678901",
      "pis": "12345678901",
      "ativo": 1
    }
  ]
}
```

```
POST /api/relogios/fila/ack
```
Confirma o resultado do processamento de um item.

```json
{ "fila_id": 42, "status": "enviado" }
{ "fila_id": 43, "status": "erro", "erro_msg": "Senha inválida" }
```

---

### Heartbeat / Saúde do sistema

```
POST /api/relogios/heartbeat
```
O sistema local envia periodicamente para indicar que está ativo.

```json
{
  "versao": "2.0.1",
  "status": "online",
  "ultimo_sync": "2026-07-11T10:35:00",
  "relogios": [
    { "id": 1, "status": "ok" },
    { "id": 2, "status": "erro", "erro": "Senha inválida" }
  ]
}
```

```
GET /api/relogios/saude
```
Retorna o último heartbeat registrado (para exibir no painel de saúde do frontend).

---

### Comunicação (frontend)

```
GET  /api/relogios/comunicacao?relogio_id=X&status=pendente&search=nome
     Lista a fila de um relógio com dados completos do funcionário

GET  /api/relogios/comunicacao/contadores
     Contagem de pendentes/erros por relógio (para badges na sidebar)

POST /api/relogios/comunicacao/enqueue
     Enfileira manualmente um funcionário para um relógio
     { "relogio_id": 1, "funcionario_id": 7, "operacao": "excluir" }

POST /api/relogios/comunicacao/retentar?relogio_id=X
     Marca todos os itens com erro como pendente novamente

DELETE /api/relogios/comunicacao/:filaId?relogio_id=X
     Remove um item da fila
```

---

## Lógica de sincronização de funcionários

### Auto-enqueue (automático)
- **Criar funcionário** → enfileira `inserir` para todos os relógios ativos (não-AFD) da empresa
- **Editar funcionário** → enfileira `atualizar` para todos os relógios ativos (não-AFD)
- Implementado em `routes/funcionarios.js` (fire-and-forget, não bloqueia a resposta)

### Manual (via UI)
- Usuário acessa **Comunicação Equipamentos** no menu
- Seleciona o relógio, clica em **+ Adicionar à fila**
- Pesquisa funcionários, seleciona vários, escolhe a operação (inserir/atualizar/excluir)
- Confirma → registros aparecem na tabela da fila

### Polling pelo sistema local
1. Autentica com `POST /api/auth/login`
2. Chama `GET /api/relogios/sync` para saber quais relógios gerenciar
3. Para cada relógio de rede (não AFD): chama `GET /api/relogios/fila?relogio_id=X`
4. Processa cada item (comunica com o equipamento via TCP/IP)
5. Para cada item: chama `POST /api/relogios/fila/ack` com `enviado` ou `erro`
6. Envia heartbeat com `POST /api/relogios/heartbeat`

### Chave do funcionário no equipamento
- Modelos `_671` → usa **CPF** (11 dígitos, sem formatação)
- Demais modelos → usa **PIS** (campo `pis` do funcionário)

---

## Arquivos do projeto

### Backend (`src/`)
```
migrations/
  029_relogios_ponto.sql          Tabela relogios_ponto
  030_relogio_usuario.sql         Coluna usuario (adicionada depois)
  031_relogio_sync_fila.sql       Tabela relogio_sync_fila
  032_relogio_sistema_saude.sql   Tabela relogio_sistema_saude

repositories/
  relogioRepository.js            CRUD de equipamentos
  relogioSyncRepository.js        Fila de sync + heartbeat

routes/
  relogios.js                     Todas as rotas de relógio
```

### Frontend (`src/`)
```
services/
  relogiosApi.ts                  CRUD de equipamentos
  relogioSyncApi.ts               Fila + heartbeat

components/relogios/
  CadastroRelogiosPage.tsx        Cadastro de equipamentos
  CadastroRelogiosPage.module.css
  RelogioComunicacaoPage.tsx      Fila de sync + saúde do sistema
  RelogioComunicacaoPage.module.css
```

---

## Observações importantes

- Relógios AFD **não participam** da fila de sincronização automática (o funcionário é cadastrado fisicamente via pen drive).
- O token JWT expira — o sistema local deve usar o `refreshToken` para renovar sem precisar fazer login novamente (`POST /api/auth/refresh`).
- O campo `processado_em` registra quando o sistema local confirmou o processamento, não quando o equipamento respondeu.
- O painel de saúde considera o sistema "sem comunicação" se `recebido_em` for há mais de 10 minutos (threshold configurável no frontend).
