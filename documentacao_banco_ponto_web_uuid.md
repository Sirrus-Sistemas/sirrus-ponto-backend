**DOCUMENTAÇÃO DO BANCO DE DADOS  
PONTO WEB**

*Modelo robusto com UUID automático, multiempresa, auditoria, REP, APP,
WEB, apuração e banco de horas*

Versão documentada: ponto_web_banco_robusto_uuid_v3.sql  
Inserts de teste: ponto_web_inserts_demo_uuid_auto_v5_mariadb.sql

# 1. Objetivo do banco de dados

Este banco foi estruturado para um projeto de Ponto Web moderno, capaz
de controlar empresas, filiais, lotações, funcionários, jornadas,
escalas, marcações de ponto, ajustes, ocorrências, apuração, banco de
horas, espelho de ponto, exportação para folha, anexos, logs e
auditoria.

A ideia principal é separar bem cada etapa do processo: cadastro,
captura da marcação, ajuste/justificativa, apuração, fechamento e
exportação. Essa separação deixa o sistema mais seguro, mais fácil de
manter e melhor preparado para relatórios e integrações.

| **Item**                    | **Definição**                                                        |
|-----------------------------|----------------------------------------------------------------------|
| SGBD sugerido               | MariaDB 10.6+ ou MySQL 8+                                            |
| Engine                      | InnoDB                                                               |
| Charset/collation           | utf8mb4 / utf8mb4_unicode_ci                                         |
| Padrão de ID                | UUID em CHAR(36), gerado pelo banco com DEFAULT (UUID())             |
| Total de tabelas principais | 49                                                                   |
| Total de views úteis        | 4                                                                    |
| Modelo                      | Multiempresa, com empresa_id na maior parte das tabelas operacionais |

# 2. Como funciona o UUID automático

Todos os identificadores principais usam UUID no formato padrão com
hífens, por exemplo: 7f8c6e8a-c6b4-11ee-8f2d-0242ac120002. No cadastro
das tabelas, o campo id recebe DEFAULT (UUID()). Assim, o sistema não
precisa informar o ID no INSERT.

id CHAR(36) NOT NULL DEFAULT (UUID())

Exemplo correto de INSERT deixando o banco gerar o UUID:

INSERT INTO empresas (razao_social, nome_fantasia, cnpj)  
VALUES ('Sirrus Sistemas LTDA', 'Sirrus Sistemas', '12345678000199');

Quando o script precisa usar o registro recém-criado em outra tabela,
ele busca o ID gerado por uma chave única, como CNPJ, CPF, matrícula,
nome ou código externo. Isso evita ID manual e mantém os relacionamentos
funcionando.

SET @empresa_sirrus_id = (  
SELECT id FROM empresas WHERE cnpj = '12345678000199' LIMIT 1  
);

# 3. Visão geral da arquitetura

O banco foi dividido em módulos para evitar tabelas gigantes e facilitar
manutenção. Cada módulo tem uma responsabilidade clara dentro do fluxo
do ponto.

| **Módulo**                                            | **Função no sistema**                                                                                                                                                                                    | **Qtd.**     |
|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| 1\. CADASTROS BASE / MULTIEMPRESA                     | Base estrutural do sistema. Define empresas, unidades, lotações, locais físicos, endereços, municípios, cargos e vínculos. É a camada que permite o uso multiempresa e a organização por filial e setor. | 8 tabela(s)  |
| 2\. FUNCIONARIOS / CONTRATOS / HISTORICOS             | Controla os colaboradores, seus dados cadastrais, vínculo, matrícula, cargo, permissões de marcação e histórico de mudanças de filial, lotação e cargo.                                                  | 2 tabela(s)  |
| 3\. USUARIOS, PERFIS E PERMISSOES                     | Controla acesso ao sistema. Separa funcionário de usuário, cria perfis, permissões e limita o escopo por empresa, filial ou lotação.                                                                     | 5 tabela(s)  |
| 4\. CONFIGURACOES DE PONTO                            | Guarda regras gerais do ponto, tolerâncias, parâmetros de fechamento, banco de horas, captura de foto, geolocalização e motivos de ocorrência.                                                           | 2 tabela(s)  |
| 5\. JORNADAS, HORARIOS E ESCALAS                      | Modela jornadas fixas, horários por dia, períodos de entrada/saída, escalas por ciclo, escala diária e feriados.                                                                                         | 11 tabela(s) |
| 6\. DISPOSITIVOS, REP, APP, WEB E MARCACOES IMUTAVEIS | Recebe registros de ponto vindos de REP, AFD, APP, WEB, API ou lançamento manual. Separa marcação bruta, ajuste e comprovante.                                                                           | 5 tabela(s)  |
| 7\. OCORRENCIAS, AFASTAMENTOS, ABONOS E SOLICITACOES  | Registra faltas justificadas, afastamentos, abonos, atestados, observações e solicitações de hora extra.                                                                                                 | 2 tabela(s)  |
| 8\. PERIODOS, APURACAO, ESPELHO, EVENTOS E FECHAMENTO | Camada de cálculo e fechamento. Transforma marcações e regras em apontamentos diários, eventos apurados, banco de horas, saldos e espelho de ponto.                                                      | 7 tabela(s)  |
| 9\. EXPORTACOES E INTEGRACOES                         | Controla códigos de folha, exportações para sistemas externos e cadastros de integrações/API.                                                                                                            | 3 tabela(s)  |
| 10\. ARQUIVOS, ANEXOS, AUDITORIA E LOGS               | Centraliza arquivos, anexos, trilha de auditoria e logs de erro, evitando dados soltos em tabelas principais.                                                                                            | 4 tabela(s)  |

# 4. Fluxo principal do Ponto Web

| **Etapa**                  | **Descrição**                                                                                                |
|----------------------------|--------------------------------------------------------------------------------------------------------------|
| 1\. Cadastro base          | Cadastrar empresa, município, endereço, filial, lotação, cargo e vínculo.                                    |
| 2\. Funcionário            | Cadastrar colaborador, matrícula, CPF, status, vínculo, cargo, filial e lotação.                             |
| 3\. Jornada ou escala      | Definir jornada fixa, períodos, escala por ciclo ou escala diária.                                           |
| 4\. Captura da marcação    | Receber marcação por REP, AFD, APP, WEB, API ou manual em marcacoes_brutas.                                  |
| 5\. Ajuste e justificativa | Registrar inclusão, correção, exclusão lógica, ocorrência, abono ou atestado sem apagar a marcação original. |
| 6\. Apuração               | Calcular previsto, trabalhado, atraso, falta, hora extra, adicional e banco de horas.                        |
| 7\. Fechamento             | Gerar período, apontamentos, eventos, saldo de banco de horas e espelho de ponto.                            |
| 8\. Exportação             | Gerar arquivo/layout para folha e registrar auditoria/logs.                                                  |

# 5. Explicação das tabelas por módulo

## 1. CADASTROS BASE / MULTIEMPRESA

Base estrutural do sistema. Define empresas, unidades, lotações, locais
físicos, endereços, municípios, cargos e vínculos. É a camada que
permite o uso multiempresa e a organização por filial e setor.

| **Tabela**             | **Finalidade**                                                                                    | **Campos principais**                                                                                                       | **Relacionamentos**                                                                   |
|------------------------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| empresas               | Cadastro principal das empresas clientes/contratantes. É o início do relacionamento multiempresa. | id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, cei_cno_caepf, email, telefone, status...   | \-                                                                                    |
| municipios             | Tabela auxiliar de municípios, UF, código IBGE e fuso horário.                                    | id, codigo_ibge, nome, uf, timezone, created_at                                                                             | \-                                                                                    |
| enderecos              | Endereços reutilizáveis para empresa, filial, lotação e locais.                                   | id, logradouro, numero, complemento, bairro, municipio_id, cep, latitude, longitude, created_at...                          | municipio_id -\> municipios(id)                                                       |
| filiais                | Unidades da empresa, como matriz e filiais.                                                       | id, empresa_id, endereco_id, codigo_externo, nome, cnpj, responsavel, telefone, email, status...                            | empresa_id -\> empresas(id), endereco_id -\> enderecos(id)                            |
| lotacoes               | Setores, departamentos ou centros de custo dentro da empresa/filial.                              | id, empresa_id, filial_id, endereco_id, codigo_externo, nome, responsavel, status, usar_configuracao_propria, created_at... | empresa_id -\> empresas(id), filial_id -\> filiais(id), endereco_id -\> enderecos(id) |
| locais_trabalho        | Pontos físicos permitidos para marcação com latitude, longitude e raio de cerca virtual.          | id, empresa_id, filial_id, lotacao_id, nome, latitude, longitude, raio_metros, permitir_ponto_fora_cerca, status...         | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id)   |
| cargos                 | Cargos dos funcionários, com CBO e status.                                                        | id, empresa_id, nome, cbo, descricao, status, created_at, updated_at                                                        | empresa_id -\> empresas(id)                                                           |
| vinculos_empregaticios | Tipos de vínculo, como CLT, estágio, PJ ou temporário.                                            | id, nome, descricao, status                                                                                                 | \-                                                                                    |

## 2. FUNCIONARIOS / CONTRATOS / HISTORICOS

Controla os colaboradores, seus dados cadastrais, vínculo, matrícula,
cargo, permissões de marcação e histórico de mudanças de filial, lotação
e cargo.

| **Tabela**                    | **Finalidade**                                                          | **Campos principais**                                                                                              | **Relacionamentos**                                                                                                                                     |
|-------------------------------|-------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| funcionarios                  | Cadastro completo dos colaboradores que batem ponto.                    | id, empresa_id, filial_id, lotacao_id, cargo_id, vinculo_id, codigo_externo, matricula, matricula_esocial, nome... | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id), cargo_id -\> cargos(id), vinculo_id -\> vinculos_empregaticios(id) |
| funcionario_historico_lotacao | Histórico de movimentação do funcionário entre filial, lotação e cargo. | id, funcionario_id, filial_id, lotacao_id, cargo_id, data_inicio, data_fim, motivo, usuario_id, created_at         | funcionario_id -\> funcionarios(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id), cargo_id -\> cargos(id)                                    |

## 3. USUARIOS, PERFIS E PERMISSOES

Controla acesso ao sistema. Separa funcionário de usuário, cria perfis,
permissões e limita o escopo por empresa, filial ou lotação.

| **Tabela**        | **Finalidade**                                                                    | **Campos principais**                                                                                             | **Relacionamentos**                                                                                                                               |
|-------------------|-----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| usuarios          | Usuários que acessam o sistema, vinculados ou não a funcionários.                 | id, funcionario_id, nome, email, senha_hash, status, ultimo_login_at, deve_trocar_senha, mfa_ativo, created_at... | funcionario_id -\> funcionarios(id)                                                                                                               |
| perfis_acesso     | Perfis agrupadores de permissões, como administrador, RH, gestor e funcionário.   | id, empresa_id, nome, descricao, status, created_at                                                               | empresa_id -\> empresas(id)                                                                                                                       |
| permissoes        | Lista técnica de permissões por módulo e ação.                                    | id, modulo, acao, descricao                                                                                       | \-                                                                                                                                                |
| perfil_permissoes | Tabela de ligação entre perfis e permissões.                                      | perfil_id, permissao_id                                                                                           | perfil_id -\> perfis_acesso(id), permissao_id -\> permissoes(id)                                                                                  |
| usuario_perfis    | Tabela de ligação entre usuários e perfis, com escopo por empresa/filial/lotação. | usuario_id, perfil_id, empresa_id, filial_id, lotacao_id, created_at                                              | usuario_id -\> usuarios(id), perfil_id -\> perfis_acesso(id), empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id) |

## 4. CONFIGURACOES DE PONTO

Guarda regras gerais do ponto, tolerâncias, parâmetros de fechamento,
banco de horas, captura de foto, geolocalização e motivos de ocorrência.

| **Tabela**          | **Finalidade**                                                  | **Campos principais**                                                                                                                                       | **Relacionamentos**                                                                 |
|---------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| configuracoes_ponto | Regras parametrizáveis do ponto por empresa, filial ou lotação. | id, empresa_id, filial_id, lotacao_id, nome, dia_inicio_periodo, dia_fim_periodo, tolerancia_entrada_min, tolerancia_saida_min, tolerancia_intervalo_min... | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id) |
| motivos_ocorrencia  | Motivos usados em faltas, abonos, afastamentos e ajustes.       | id, empresa_id, nome, abreviacao, tipo, exige_anexo, abona_horas, gera_banco_horas, gera_absenteismo, status...                                             | empresa_id -\> empresas(id)                                                         |

## 5. JORNADAS, HORARIOS E ESCALAS

Modela jornadas fixas, horários por dia, períodos de entrada/saída,
escalas por ciclo, escala diária e feriados.

| **Tabela**                 | **Finalidade**                                                            | **Campos principais**                                                                                                     | **Relacionamentos**                                                                           |
|----------------------------|---------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| jornadas                   | Cabeçalho das jornadas de trabalho.                                       | id, empresa_id, nome, tipo, carga_semanal_min, carga_mensal_min, intervalo_minimo_min, status, created_at, updated_at...  | empresa_id -\> empresas(id)                                                                   |
| jornada_dias               | Define quais dias da semana compõem uma jornada e a carga prevista.       | id, jornada_id, dia_semana, trabalha, carga_prevista_min, tolerancia_entrada_min, tolerancia_saida_min, created_at, CHECK | jornada_id -\> jornadas(id)                                                                   |
| jornada_periodos           | Define períodos dentro do dia, como entrada, intervalo e saída.           | id, jornada_dia_id, sequencia, tipo, hora_inicio, hora_fim, vira_dia, created_at                                          | jornada_dia_id -\> jornada_dias(id)                                                           |
| funcionario_jornadas       | Vincula funcionário a uma jornada por período de vigência.                | id, funcionario_id, jornada_id, data_inicio, data_fim, observacao, usuario_id, created_at                                 | funcionario_id -\> funcionarios(id), jornada_id -\> jornadas(id), usuario_id -\> usuarios(id) |
| escalas_modelo             | Modelos de escala por ciclo, como 12x36, 6x1 ou escala variável.          | id, empresa_id, nome, tipo, dias_ciclo, status, created_at, updated_at                                                    | empresa_id -\> empresas(id)                                                                   |
| escala_dias_modelo         | Dias de cada ciclo de escala, indicando trabalho, folga e carga prevista. | id, escala_modelo_id, dia_ciclo, trabalha, carga_prevista_min, observacao                                                 | escala_modelo_id -\> escalas_modelo(id)                                                       |
| escala_dia_periodos_modelo | Períodos de trabalho de cada dia do modelo de escala.                     | id, escala_dia_modelo_id, sequencia, hora_inicio, hora_fim, vira_dia                                                      | escala_dia_modelo_id -\> escala_dias_modelo(id)                                               |
| funcionario_escalas        | Vincula funcionário a modelo de escala por vigência.                      | id, funcionario_id, escala_modelo_id, data_inicio, data_fim, dia_ciclo_inicial, created_at                                | funcionario_id -\> funcionarios(id), escala_modelo_id -\> escalas_modelo(id)                  |
| escala_diaria              | Escala efetiva de um funcionário em uma data específica.                  | id, funcionario_id, data, origem, trabalha, folga, carga_prevista_min, observacao, usuario_id, created_at...              | funcionario_id -\> funcionarios(id), usuario_id -\> usuarios(id)                              |
| escala_diaria_periodos     | Períodos efetivos da escala diária.                                       | id, escala_diaria_id, sequencia, hora_inicio, hora_fim, vira_dia                                                          | escala_diaria_id -\> escala_diaria(id)                                                        |
| feriados                   | Feriados nacionais, estaduais, municipais ou internos.                    | id, empresa_id, municipio_id, nome, data, tipo, permanente, gera_extra, status, created_at                                | empresa_id -\> empresas(id), municipio_id -\> municipios(id)                                  |

## 6. DISPOSITIVOS, REP, APP, WEB E MARCACOES IMUTAVEIS

Recebe registros de ponto vindos de REP, AFD, APP, WEB, API ou
lançamento manual. Separa marcação bruta, ajuste e comprovante.

| **Tabela**         | **Finalidade**                                                                  | **Campos principais**                                                                                                                          | **Relacionamentos**                                                                                                                                                                                                                         |
|--------------------|---------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| dispositivos_ponto | Cadastro dos equipamentos ou meios de registro de ponto.                        | id, empresa_id, filial_id, lotacao_id, tipo, fabricante, modelo, numero_fabricacao, descricao, ip...                                           | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id)                                                                                                                                                         |
| importacoes_ponto  | Controle de importações de arquivos AFD ou cargas externas.                     | id, empresa_id, dispositivo_id, tipo, arquivo_id, status, total_linhas, total_importadas, total_ignoradas, iniciado_at...                      | empresa_id -\> empresas(id), dispositivo_id -\> dispositivos_ponto(id), usuario_id -\> usuarios(id)                                                                                                                                         |
| marcacoes_brutas   | Registro original da batida de ponto. Deve ser preservado para rastreabilidade. | id, empresa_id, funcionario_id, dispositivo_id, importacao_id, origem, nsr, data_hora_local, data_hora_utc, timezone...                        | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), dispositivo_id -\> dispositivos_ponto(id), importacao_id -\> importacoes_ponto(id)                                                                                        |
| marcacoes_ajustes  | Ajustes ou inclusões feitos sobre marcações, com justificativa e aprovação.     | id, empresa_id, funcionario_id, marcacao_original_id, data_hora_original, data_hora_ajustada, tipo_ajuste, motivo_id, justificativa, status... | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), marcacao_original_id -\> marcacoes_brutas(id), motivo_id -\> motivos_ocorrencia(id), solicitado_por_usuario_id -\> usuarios(id), avaliado_por_usuario_id -\> usuarios(id) |
| comprovantes_ponto | Comprovantes associados a marcações, com arquivo e assinatura/hash.             | id, marcacao_id, arquivo_id, assinatura_digital_hash, padrao_assinatura, emitido_at, entregue_ao_trabalhador, created_at                       | marcacao_id -\> marcacoes_brutas(id)                                                                                                                                                                                                        |

## 7. OCORRENCIAS, AFASTAMENTOS, ABONOS E SOLICITACOES

Registra faltas justificadas, afastamentos, abonos, atestados,
observações e solicitações de hora extra.

| **Tabela**              | **Finalidade**                                                               | **Campos principais**                                                                                                           | **Relacionamentos**                                                                                                                                                                          |
|-------------------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ocorrencias             | Ocorrências de ponto, afastamentos, abonos, faltas justificadas e atestados. | id, empresa_id, funcionario_id, motivo_id, origem, data_inicio, data_fim, hora_inicio, hora_fim, total_minutos...               | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), motivo_id -\> motivos_ocorrencia(id), solicitado_por_usuario_id -\> usuarios(id), avaliado_por_usuario_id -\> usuarios(id) |
| solicitacoes_hora_extra | Solicitações e aprovações de hora extra.                                     | id, empresa_id, funcionario_id, data, hora_inicio, hora_fim, total_minutos, justificativa, status, solicitado_por_usuario_id... | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), solicitado_por_usuario_id -\> usuarios(id), avaliado_por_usuario_id -\> usuarios(id)                                       |

## 8. PERIODOS, APURACAO, ESPELHO, EVENTOS E FECHAMENTO

Camada de cálculo e fechamento. Transforma marcações e regras em
apontamentos diários, eventos apurados, banco de horas, saldos e espelho
de ponto.

| **Tabela**             | **Finalidade**                                                               | **Campos principais**                                                                                                                              | **Relacionamentos**                                                                                                                                                              |
|------------------------|------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| periodos_apuracao      | Competências/períodos de cálculo e fechamento do ponto.                      | id, empresa_id, filial_id, lotacao_id, competencia, data_inicio, data_fim, status, fechado_por_usuario_id, fechado_at...                           | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id), fechado_por_usuario_id -\> usuarios(id)                                                     |
| apontamentos_diarios   | Resultado consolidado diário por funcionário.                                | id, periodo_id, empresa_id, funcionario_id, data, status, previsto_min, trabalhado_min, atraso_min, falta_min...                                   | periodo_id -\> periodos_apuracao(id), empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), calculado_por_usuario_id -\> usuarios(id)                                |
| apontamento_marcacoes  | Liga marcações usadas em cada apontamento diário.                            | id, apontamento_id, marcacao_id, sequencia, papel, created_at                                                                                      | apontamento_id -\> apontamentos_diarios(id), marcacao_id -\> marcacoes_brutas(id)                                                                                                |
| eventos_apurados       | Eventos gerados na apuração, como falta, extra, atraso e adicional.          | id, apontamento_id, tipo, quantidade_min, percentual, codigo_folha, descricao, created_at                                                          | apontamento_id -\> apontamentos_diarios(id)                                                                                                                                      |
| banco_horas_movimentos | Movimentos detalhados de crédito, débito, ajuste ou baixa do banco de horas. | id, empresa_id, funcionario_id, periodo_id, apontamento_id, data, tipo, origem, minutos, saldo_anterior_min...                                     | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id), periodo_id -\> periodos_apuracao(id), apontamento_id -\> apontamentos_diarios(id), usuario_id -\> usuarios(id) |
| banco_horas_saldos     | Saldo consolidado de banco de horas por competência.                         | id, empresa_id, funcionario_id, competencia, saldo_anterior_min, creditos_min, debitos_min, baixas_min, saldo_final_min, fechado...                | empresa_id -\> empresas(id), funcionario_id -\> funcionarios(id)                                                                                                                 |
| espelhos_ponto         | Espelhos de ponto gerados e assinados/contestados.                           | id, periodo_id, funcionario_id, status, arquivo_id, hash_documento, assinatura_funcionario_hash, assinatura_empresa_hash, gerado_at, enviado_at... | periodo_id -\> periodos_apuracao(id), funcionario_id -\> funcionarios(id)                                                                                                        |

## 9. EXPORTACOES E INTEGRACOES

Controla códigos de folha, exportações para sistemas externos e
cadastros de integrações/API.

| **Tabela**               | **Finalidade**                                                   | **Campos principais**                                                                                                              | **Relacionamentos**                                                                                       |
|--------------------------|------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| codigos_exportacao_folha | Mapeia eventos do ponto para códigos usados no sistema de folha. | id, empresa_id, filial_id, lotacao_id, evento_tipo, codigo_folha, descricao, status, created_at                                    | empresa_id -\> empresas(id), filial_id -\> filiais(id), lotacao_id -\> lotacoes(id)                       |
| exportacoes_folha        | Controle de arquivos exportados para folha de pagamento.         | id, periodo_id, empresa_id, tipo_layout, sistema_destino, status, arquivo_id, total_registros, gerado_por_usuario_id, gerado_at... | periodo_id -\> periodos_apuracao(id), empresa_id -\> empresas(id), gerado_por_usuario_id -\> usuarios(id) |
| integracoes_externas     | Configurações de APIs e sistemas externos.                       | id, empresa_id, nome, tipo, ambiente, base_url, credenciais_criptografadas, configuracao_json, status, ultimo_sync_at...           | empresa_id -\> empresas(id)                                                                               |

## 10. ARQUIVOS, ANEXOS, AUDITORIA E LOGS

Centraliza arquivos, anexos, trilha de auditoria e logs de erro,
evitando dados soltos em tabelas principais.

| **Tabela**        | **Finalidade**                                              | **Campos principais**                                                                                                                           | **Relacionamentos**                                                 |
|-------------------|-------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| arquivos          | Metadados de arquivos guardados em disco, nuvem ou storage. | id, empresa_id, nome_original, nome_armazenado, mime_type, tamanho_bytes, storage_provider, storage_path, hash_sha256, criado_por_usuario_id... | empresa_id -\> empresas(id), criado_por_usuario_id -\> usuarios(id) |
| ocorrencia_anexos | Ligação entre ocorrências e arquivos anexados.              | ocorrencia_id, arquivo_id, created_at                                                                                                           | ocorrencia_id -\> ocorrencias(id), arquivo_id -\> arquivos(id)      |
| auditoria_eventos | Auditoria de ações, com dados antes e depois em JSON.       | id, empresa_id, usuario_id, entidade, entidade_id, acao, antes_json, depois_json, ip_origem, user_agent...                                      | empresa_id -\> empresas(id), usuario_id -\> usuarios(id)            |
| logs_erros        | Registro técnico de erros do sistema.                       | id, empresa_id, usuario_id, origem, nivel, mensagem, stacktrace, contexto_json, created_at                                                      | empresa_id -\> empresas(id), usuario_id -\> usuarios(id)            |

# 6. Views disponíveis

As views foram criadas para facilitar consultas frequentes no sistema,
principalmente telas de pesquisa, dashboards e acompanhamento
operacional.

| **View**                   | **Uso**                                                                                        |
|----------------------------|------------------------------------------------------------------------------------------------|
| vw_funcionarios_ativos     | Lista funcionários ativos com empresa, filial, lotação e cargo, facilitando telas de consulta. |
| vw_marcacoes_dia           | Exibe marcações agrupáveis por funcionário e data, útil para tela diária de batidas.           |
| vw_banco_horas_saldo_atual | Mostra o saldo mais recente de banco de horas de cada funcionário.                             |
| vw_inconsistencias_ponto   | Lista apontamentos com inconsistências, como falta, marcação ímpar ou pendência de aprovação.  |

# 7. Principais relacionamentos

As chaves estrangeiras ajudam a evitar registros órfãos e deixam o banco
mais confiável para relatórios e fechamento.

| **Tabela origem**             | **Campo**                 | **Tabela destino**     | **Campo destino** |
|-------------------------------|---------------------------|------------------------|-------------------|
| enderecos                     | municipio_id              | municipios             | id                |
| filiais                       | empresa_id                | empresas               | id                |
| filiais                       | endereco_id               | enderecos              | id                |
| lotacoes                      | empresa_id                | empresas               | id                |
| lotacoes                      | filial_id                 | filiais                | id                |
| lotacoes                      | endereco_id               | enderecos              | id                |
| locais_trabalho               | empresa_id                | empresas               | id                |
| locais_trabalho               | filial_id                 | filiais                | id                |
| locais_trabalho               | lotacao_id                | lotacoes               | id                |
| cargos                        | empresa_id                | empresas               | id                |
| funcionarios                  | empresa_id                | empresas               | id                |
| funcionarios                  | filial_id                 | filiais                | id                |
| funcionarios                  | lotacao_id                | lotacoes               | id                |
| funcionarios                  | cargo_id                  | cargos                 | id                |
| funcionarios                  | vinculo_id                | vinculos_empregaticios | id                |
| funcionario_historico_lotacao | funcionario_id            | funcionarios           | id                |
| funcionario_historico_lotacao | filial_id                 | filiais                | id                |
| funcionario_historico_lotacao | lotacao_id                | lotacoes               | id                |
| funcionario_historico_lotacao | cargo_id                  | cargos                 | id                |
| usuarios                      | funcionario_id            | funcionarios           | id                |
| perfis_acesso                 | empresa_id                | empresas               | id                |
| perfil_permissoes             | perfil_id                 | perfis_acesso          | id                |
| perfil_permissoes             | permissao_id              | permissoes             | id                |
| usuario_perfis                | usuario_id                | usuarios               | id                |
| usuario_perfis                | perfil_id                 | perfis_acesso          | id                |
| usuario_perfis                | empresa_id                | empresas               | id                |
| usuario_perfis                | filial_id                 | filiais                | id                |
| usuario_perfis                | lotacao_id                | lotacoes               | id                |
| configuracoes_ponto           | empresa_id                | empresas               | id                |
| configuracoes_ponto           | filial_id                 | filiais                | id                |
| configuracoes_ponto           | lotacao_id                | lotacoes               | id                |
| motivos_ocorrencia            | empresa_id                | empresas               | id                |
| jornadas                      | empresa_id                | empresas               | id                |
| jornada_dias                  | jornada_id                | jornadas               | id                |
| jornada_periodos              | jornada_dia_id            | jornada_dias           | id                |
| funcionario_jornadas          | funcionario_id            | funcionarios           | id                |
| funcionario_jornadas          | jornada_id                | jornadas               | id                |
| funcionario_jornadas          | usuario_id                | usuarios               | id                |
| escalas_modelo                | empresa_id                | empresas               | id                |
| escala_dias_modelo            | escala_modelo_id          | escalas_modelo         | id                |
| escala_dia_periodos_modelo    | escala_dia_modelo_id      | escala_dias_modelo     | id                |
| funcionario_escalas           | funcionario_id            | funcionarios           | id                |
| funcionario_escalas           | escala_modelo_id          | escalas_modelo         | id                |
| escala_diaria                 | funcionario_id            | funcionarios           | id                |
| escala_diaria                 | usuario_id                | usuarios               | id                |
| escala_diaria_periodos        | escala_diaria_id          | escala_diaria          | id                |
| feriados                      | empresa_id                | empresas               | id                |
| feriados                      | municipio_id              | municipios             | id                |
| dispositivos_ponto            | empresa_id                | empresas               | id                |
| dispositivos_ponto            | filial_id                 | filiais                | id                |
| dispositivos_ponto            | lotacao_id                | lotacoes               | id                |
| importacoes_ponto             | empresa_id                | empresas               | id                |
| importacoes_ponto             | dispositivo_id            | dispositivos_ponto     | id                |
| importacoes_ponto             | usuario_id                | usuarios               | id                |
| marcacoes_brutas              | empresa_id                | empresas               | id                |
| marcacoes_brutas              | funcionario_id            | funcionarios           | id                |
| marcacoes_brutas              | dispositivo_id            | dispositivos_ponto     | id                |
| marcacoes_brutas              | importacao_id             | importacoes_ponto      | id                |
| marcacoes_ajustes             | empresa_id                | empresas               | id                |
| marcacoes_ajustes             | funcionario_id            | funcionarios           | id                |
| marcacoes_ajustes             | marcacao_original_id      | marcacoes_brutas       | id                |
| marcacoes_ajustes             | motivo_id                 | motivos_ocorrencia     | id                |
| marcacoes_ajustes             | solicitado_por_usuario_id | usuarios               | id                |
| marcacoes_ajustes             | avaliado_por_usuario_id   | usuarios               | id                |
| comprovantes_ponto            | marcacao_id               | marcacoes_brutas       | id                |
| ocorrencias                   | empresa_id                | empresas               | id                |
| ocorrencias                   | funcionario_id            | funcionarios           | id                |
| ocorrencias                   | motivo_id                 | motivos_ocorrencia     | id                |
| ocorrencias                   | solicitado_por_usuario_id | usuarios               | id                |
| ocorrencias                   | avaliado_por_usuario_id   | usuarios               | id                |
| solicitacoes_hora_extra       | empresa_id                | empresas               | id                |
| solicitacoes_hora_extra       | funcionario_id            | funcionarios           | id                |
| solicitacoes_hora_extra       | solicitado_por_usuario_id | usuarios               | id                |
| solicitacoes_hora_extra       | avaliado_por_usuario_id   | usuarios               | id                |
| periodos_apuracao             | empresa_id                | empresas               | id                |
| periodos_apuracao             | filial_id                 | filiais                | id                |
| periodos_apuracao             | lotacao_id                | lotacoes               | id                |
| periodos_apuracao             | fechado_por_usuario_id    | usuarios               | id                |
| apontamentos_diarios          | periodo_id                | periodos_apuracao      | id                |
| apontamentos_diarios          | empresa_id                | empresas               | id                |
| apontamentos_diarios          | funcionario_id            | funcionarios           | id                |
| apontamentos_diarios          | calculado_por_usuario_id  | usuarios               | id                |
| apontamento_marcacoes         | apontamento_id            | apontamentos_diarios   | id                |
| apontamento_marcacoes         | marcacao_id               | marcacoes_brutas       | id                |
| eventos_apurados              | apontamento_id            | apontamentos_diarios   | id                |
| banco_horas_movimentos        | empresa_id                | empresas               | id                |
| banco_horas_movimentos        | funcionario_id            | funcionarios           | id                |
| banco_horas_movimentos        | periodo_id                | periodos_apuracao      | id                |
| banco_horas_movimentos        | apontamento_id            | apontamentos_diarios   | id                |
| banco_horas_movimentos        | usuario_id                | usuarios               | id                |
| banco_horas_saldos            | empresa_id                | empresas               | id                |
| banco_horas_saldos            | funcionario_id            | funcionarios           | id                |
| espelhos_ponto                | periodo_id                | periodos_apuracao      | id                |
| espelhos_ponto                | funcionario_id            | funcionarios           | id                |
| codigos_exportacao_folha      | empresa_id                | empresas               | id                |
| codigos_exportacao_folha      | filial_id                 | filiais                | id                |
| codigos_exportacao_folha      | lotacao_id                | lotacoes               | id                |
| exportacoes_folha             | periodo_id                | periodos_apuracao      | id                |
| exportacoes_folha             | empresa_id                | empresas               | id                |
| exportacoes_folha             | gerado_por_usuario_id     | usuarios               | id                |
| integracoes_externas          | empresa_id                | empresas               | id                |
| arquivos                      | empresa_id                | empresas               | id                |
| arquivos                      | criado_por_usuario_id     | usuarios               | id                |
| ocorrencia_anexos             | ocorrencia_id             | ocorrencias            | id                |
| ocorrencia_anexos             | arquivo_id                | arquivos               | id                |
| auditoria_eventos             | empresa_id                | empresas               | id                |
| auditoria_eventos             | usuario_id                | usuarios               | id                |
| logs_erros                    | empresa_id                | empresas               | id                |
| logs_erros                    | usuario_id                | usuarios               | id                |

# 8. Regras importantes do modelo

| **Regra**                            | **Explicação**                                                                                                                        |
|--------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| Marcação bruta não deve ser alterada | A tabela marcacoes_brutas deve guardar o registro original. Correções entram em marcacoes_ajustes, com motivo, aprovação e auditoria. |
| Multiempresa                         | Tabelas operacionais possuem empresa_id para separar dados de cada cliente/empresa.                                                   |
| Exclusão lógica                      | Quando existir deleted_at, prefira marcar exclusão lógica em vez de apagar fisicamente o registro.                                    |
| Auditoria                            | Ações importantes devem gerar registro em auditoria_eventos com antes_json e depois_json.                                             |
| Arquivos fora das tabelas principais | Atestados, fotos, espelhos e comprovantes devem ser referenciados pela tabela arquivos.                                               |
| Banco de horas separado              | Movimentos ficam em banco_horas_movimentos; saldo consolidado fica em banco_horas_saldos.                                             |
| Apuração recalculável                | Sempre que possível, marque alterações e reprocesse a apuração em vez de sobrescrever históricos.                                     |

# 9. Consultas úteis para teste

Após rodar o banco principal e os inserts de demonstração, estas
consultas ajudam a visualizar se o ambiente está funcionando:

SELECT \* FROM vw_funcionarios_ativos;  
  
SELECT \* FROM vw_marcacoes_dia;  
  
SELECT \* FROM vw_inconsistencias_ponto;  
  
SELECT \* FROM vw_banco_horas_saldo_atual;

# 10. Dicionário compacto de campos por tabela

Abaixo está um resumo compacto dos campos de cada tabela. Para
implementação no backend, use este bloco como guia de entidades/modelos.

## 1. CADASTROS BASE / MULTIEMPRESA

| **Tabela**             | **Campos**                                                                                                                                                                  |
|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| empresas               | id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, cei_cno_caepf, email, telefone, status, timezone_padrao, created_at, updated_at, deleted_at |
| municipios             | id, codigo_ibge, nome, uf, timezone, created_at                                                                                                                             |
| enderecos              | id, logradouro, numero, complemento, bairro, municipio_id, cep, latitude, longitude, created_at, updated_at                                                                 |
| filiais                | id, empresa_id, endereco_id, codigo_externo, nome, cnpj, responsavel, telefone, email, status, created_at, updated_at, deleted_at                                           |
| lotacoes               | id, empresa_id, filial_id, endereco_id, codigo_externo, nome, responsavel, status, usar_configuracao_propria, created_at, updated_at, deleted_at                            |
| locais_trabalho        | id, empresa_id, filial_id, lotacao_id, nome, latitude, longitude, raio_metros, permitir_ponto_fora_cerca, status, created_at, updated_at                                    |
| cargos                 | id, empresa_id, nome, cbo, descricao, status, created_at, updated_at                                                                                                        |
| vinculos_empregaticios | id, nome, descricao, status                                                                                                                                                 |

## 2. FUNCIONARIOS / CONTRATOS / HISTORICOS

| **Tabela**                    | **Campos**                                                                                                                                                                                                                                                                                                                                                                                                                            |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| funcionarios                  | id, empresa_id, filial_id, lotacao_id, cargo_id, vinculo_id, codigo_externo, matricula, matricula_esocial, nome, nome_social, cpf, pis_pasep, rg, data_nascimento, data_admissao, data_demissao, email, celular, foto_arquivo_id, status, usa_banco_horas, permite_ponto_web, permite_ponto_app, permite_ponto_manual, exige_geolocalizacao, exige_foto, exige_reconhecimento_facial, observacoes, created_at, updated_at, deleted_at |
| funcionario_historico_lotacao | id, funcionario_id, filial_id, lotacao_id, cargo_id, data_inicio, data_fim, motivo, usuario_id, created_at                                                                                                                                                                                                                                                                                                                            |

## 3. USUARIOS, PERFIS E PERMISSOES

| **Tabela**        | **Campos**                                                                                                                             |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| usuarios          | id, funcionario_id, nome, email, senha_hash, status, ultimo_login_at, deve_trocar_senha, mfa_ativo, created_at, updated_at, deleted_at |
| perfis_acesso     | id, empresa_id, nome, descricao, status, created_at                                                                                    |
| permissoes        | id, modulo, acao, descricao                                                                                                            |
| perfil_permissoes | perfil_id, permissao_id                                                                                                                |
| usuario_perfis    | usuario_id, perfil_id, empresa_id, filial_id, lotacao_id, created_at                                                                   |

## 4. CONFIGURACOES DE PONTO

| **Tabela**          | **Campos**                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| configuracoes_ponto | id, empresa_id, filial_id, lotacao_id, nome, dia_inicio_periodo, dia_fim_periodo, tolerancia_entrada_min, tolerancia_saida_min, tolerancia_intervalo_min, limite_marcacoes_dia, permite_marcacao_offline, exige_aprovacao_marcacao_manual, calcula_adicional_noturno, inicio_noturno, fim_noturno, percentual_extra_1, percentual_extra_2, sabado_regra, domingo_regra, feriado_regra, arredondar_marcacoes, regra_json, created_at, updated_at, CHECK, CHECK |
| motivos_ocorrencia  | id, empresa_id, nome, abreviacao, tipo, exige_anexo, abona_horas, gera_banco_horas, gera_absenteismo, status, created_at                                                                                                                                                                                                                                                                                                                                      |

## 5. JORNADAS, HORARIOS E ESCALAS

| **Tabela**                 | **Campos**                                                                                                                        |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| jornadas                   | id, empresa_id, nome, tipo, carga_semanal_min, carga_mensal_min, intervalo_minimo_min, status, created_at, updated_at, deleted_at |
| jornada_dias               | id, jornada_id, dia_semana, trabalha, carga_prevista_min, tolerancia_entrada_min, tolerancia_saida_min, created_at, CHECK         |
| jornada_periodos           | id, jornada_dia_id, sequencia, tipo, hora_inicio, hora_fim, vira_dia, created_at                                                  |
| funcionario_jornadas       | id, funcionario_id, jornada_id, data_inicio, data_fim, observacao, usuario_id, created_at                                         |
| escalas_modelo             | id, empresa_id, nome, tipo, dias_ciclo, status, created_at, updated_at                                                            |
| escala_dias_modelo         | id, escala_modelo_id, dia_ciclo, trabalha, carga_prevista_min, observacao                                                         |
| escala_dia_periodos_modelo | id, escala_dia_modelo_id, sequencia, hora_inicio, hora_fim, vira_dia                                                              |
| funcionario_escalas        | id, funcionario_id, escala_modelo_id, data_inicio, data_fim, dia_ciclo_inicial, created_at                                        |
| escala_diaria              | id, funcionario_id, data, origem, trabalha, folga, carga_prevista_min, observacao, usuario_id, created_at, updated_at             |
| escala_diaria_periodos     | id, escala_diaria_id, sequencia, hora_inicio, hora_fim, vira_dia                                                                  |
| feriados                   | id, empresa_id, municipio_id, nome, data, tipo, permanente, gera_extra, status, created_at                                        |

## 6. DISPOSITIVOS, REP, APP, WEB E MARCACOES IMUTAVEIS

| **Tabela**         | **Campos**                                                                                                                                                                                                                                                                                                                                                                       |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| dispositivos_ponto | id, empresa_id, filial_id, lotacao_id, tipo, fabricante, modelo, numero_fabricacao, descricao, ip, porta, timezone, certificado_identificador, status, ultima_coleta_at, created_at, updated_at, deleted_at                                                                                                                                                                      |
| importacoes_ponto  | id, empresa_id, dispositivo_id, tipo, arquivo_id, status, total_linhas, total_importadas, total_ignoradas, iniciado_at, finalizado_at, usuario_id, erro_resumo, created_at                                                                                                                                                                                                       |
| marcacoes_brutas   | id, empresa_id, funcionario_id, dispositivo_id, importacao_id, origem, nsr, data_hora_local, data_hora_utc, timezone, tipo, direcao_calculada, pis_pasep, cpf, matricula, latitude, longitude, precisao_metros, dentro_cerca, foto_arquivo_id, reconhecimento_facial_score, hash_registro, hash_anterior, ip_origem, user_agent, status, motivo_rejeicao, observacao, created_at |
| marcacoes_ajustes  | id, empresa_id, funcionario_id, marcacao_original_id, data_hora_original, data_hora_ajustada, tipo_ajuste, motivo_id, justificativa, status, solicitado_por_usuario_id, avaliado_por_usuario_id, avaliado_at, created_at, updated_at                                                                                                                                             |
| comprovantes_ponto | id, marcacao_id, arquivo_id, assinatura_digital_hash, padrao_assinatura, emitido_at, entregue_ao_trabalhador, created_at                                                                                                                                                                                                                                                         |

## 7. OCORRENCIAS, AFASTAMENTOS, ABONOS E SOLICITACOES

| **Tabela**              | **Campos**                                                                                                                                                                                                                                   |
|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ocorrencias             | id, empresa_id, funcionario_id, motivo_id, origem, data_inicio, data_fim, hora_inicio, hora_fim, total_minutos, turno, justificativa, status, solicitado_por_usuario_id, avaliado_por_usuario_id, avaliado_at, created_at, updated_at, CHECK |
| solicitacoes_hora_extra | id, empresa_id, funcionario_id, data, hora_inicio, hora_fim, total_minutos, justificativa, status, solicitado_por_usuario_id, avaliado_por_usuario_id, avaliado_at, created_at, updated_at                                                   |

## 8. PERIODOS, APURACAO, ESPELHO, EVENTOS E FECHAMENTO

| **Tabela**             | **Campos**                                                                                                                                                                                                                                                                                  |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| periodos_apuracao      | id, empresa_id, filial_id, lotacao_id, competencia, data_inicio, data_fim, status, fechado_por_usuario_id, fechado_at, observacao, created_at, updated_at, CHECK                                                                                                                            |
| apontamentos_diarios   | id, periodo_id, empresa_id, funcionario_id, data, status, previsto_min, trabalhado_min, atraso_min, falta_min, extra_50_min, extra_100_min, adicional_noturno_min, banco_credito_min, banco_debito_min, dsr_min, observacao, calculado_at, calculado_por_usuario_id, created_at, updated_at |
| apontamento_marcacoes  | id, apontamento_id, marcacao_id, sequencia, papel, created_at                                                                                                                                                                                                                               |
| eventos_apurados       | id, apontamento_id, tipo, quantidade_min, percentual, codigo_folha, descricao, created_at                                                                                                                                                                                                   |
| banco_horas_movimentos | id, empresa_id, funcionario_id, periodo_id, apontamento_id, data, tipo, origem, minutos, saldo_anterior_min, saldo_atual_min, observacao, usuario_id, created_at                                                                                                                            |
| banco_horas_saldos     | id, empresa_id, funcionario_id, competencia, saldo_anterior_min, creditos_min, debitos_min, baixas_min, saldo_final_min, fechado, updated_at                                                                                                                                                |
| espelhos_ponto         | id, periodo_id, funcionario_id, status, arquivo_id, hash_documento, assinatura_funcionario_hash, assinatura_empresa_hash, gerado_at, enviado_at, assinado_at, contestado_at, observacao, created_at                                                                                         |

## 9. EXPORTACOES E INTEGRACOES

| **Tabela**               | **Campos**                                                                                                                                               |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| codigos_exportacao_folha | id, empresa_id, filial_id, lotacao_id, evento_tipo, codigo_folha, descricao, status, created_at                                                          |
| exportacoes_folha        | id, periodo_id, empresa_id, tipo_layout, sistema_destino, status, arquivo_id, total_registros, gerado_por_usuario_id, gerado_at, erro_resumo, created_at |
| integracoes_externas     | id, empresa_id, nome, tipo, ambiente, base_url, credenciais_criptografadas, configuracao_json, status, ultimo_sync_at, created_at, updated_at            |

## 10. ARQUIVOS, ANEXOS, AUDITORIA E LOGS

| **Tabela**        | **Campos**                                                                                                                                               |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| arquivos          | id, empresa_id, nome_original, nome_armazenado, mime_type, tamanho_bytes, storage_provider, storage_path, hash_sha256, criado_por_usuario_id, created_at |
| ocorrencia_anexos | ocorrencia_id, arquivo_id, created_at                                                                                                                    |
| auditoria_eventos | id, empresa_id, usuario_id, entidade, entidade_id, acao, antes_json, depois_json, ip_origem, user_agent, hash_evento, hash_anterior, created_at          |
| logs_erros        | id, empresa_id, usuario_id, origem, nivel, mensagem, stacktrace, contexto_json, created_at                                                               |

# 11. Observações técnicas sobre campos recorrentes

| **Campo**                      | **Orientação**                                                             |
|--------------------------------|----------------------------------------------------------------------------|
| id                             | UUID automático, gerado pelo banco. Não precisa ser enviado nos inserts.   |
| created_at / updated_at        | Controle de criação e alteração do registro.                               |
| deleted_at                     | Permite exclusão lógica sem perder histórico.                              |
| empresa_id                     | Base do modelo multiempresa.                                               |
| status                         | Indica situação do registro, evitando depender apenas de exclusão física.  |
| origem                         | Identifica se o dado veio de REP, AFD, APP, WEB, API ou lançamento manual. |
| hash_registro / hash_documento | Ajuda na integridade e rastreabilidade.                                    |
| latitude / longitude           | Usado para geolocalização e cerca virtual.                                 |
| antes_json / depois_json       | Guarda o estado anterior e posterior em auditoria.                         |

# 12. Recomendações para evolução do projeto

- Criar migrations oficiais no backend em vez de alterar o banco
  manualmente em produção.

- Criar camada de serviços para apuração, evitando cálculo de ponto
  diretamente nas telas.

- Padronizar o envio de IDs: o frontend/API não deve criar UUID
  manualmente para tabelas principais.

- Criar testes automatizados para jornada normal, escala 12x36, marcação
  ímpar, falta, hora extra, banco de horas e fechamento.

- Criar política de LGPD para foto, geolocalização, documentos anexos e
  dados pessoais.

- Criar rotina de auditoria para alterações sensíveis, principalmente
  ajustes de ponto, exclusões, fechamento e exportação.

- Validar performance com volume real de marcações antes de colocar em
  produção.