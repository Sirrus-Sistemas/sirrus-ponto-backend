USE ponto_web;

-- Data de admissão passou a ser opcional no cadastro do funcionário (o import
-- da planilha já aceitava vazio). Em alguns bancos a coluna ainda é NOT NULL
-- (001_create_tables), o que derrubaria o INSERT sem a data.
ALTER TABLE funcionarios
  MODIFY COLUMN data_admissao DATE NULL;
