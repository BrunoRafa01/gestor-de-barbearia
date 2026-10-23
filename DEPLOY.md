# Publicar o Gestor de Barbearia online de graca

Gestor de Barbearia - Nova Runtime

Este guia leva o sistema do seu computador para a internet usando **apenas
servicos gratuitos**: GitHub (codigo), Render (servidor + HTTPS + endereco web)
e Turso (banco de dados).

Tempo estimado: 20 a 30 minutos. Nao e preciso cartao de credito em nenhum passo.

---

## Por que o banco fica no Turso?

O sistema usa SQLite. No plano gratuito do Render **o disco e temporario**: toda
vez que o servico e reiniciado ou atualizado, os arquivos gravados nele sao
apagados - um banco SQLite local perderia todos os agendamentos.

Por isso o sistema tem **dois drivers** e escolhe sozinho:

| Situacao | Driver usado | Onde ficam os dados |
| --- | --- | --- |
| No seu computador (sem configuracao) | `node:sqlite` (arquivo local) | Pasta `data/` |
| No Render, com `TURSO_DATABASE_URL` definida | `@libsql/client` (libSQL) | Nuvem do Turso |

Nada mais precisa ser alterado: basta informar as duas variaveis do Turso.

---

## Passo 1 - Criar o banco gratuito no Turso

1. Acesse <https://turso.tech> e crie uma conta gratuita (pode entrar com GitHub).
2. No painel, clique em **Create Database**.
   - Nome: `barbearia`
   - Regiao: escolha a mais proxima (ex.: `us-east` ou `sa-east` se disponivel).
3. Abra o banco criado e copie a **URL de conexao**. Ela comeca com
   `libsql://` (ex.: `libsql://barbearia-seunome.turso.io`).
4. Clique em **Create Token** (ou "Generate Token"), copie o token e guarde.
   Ele so aparece uma vez.

Guarde os dois valores:

```
TURSO_DATABASE_URL = libsql://barbearia-....turso.io
TURSO_AUTH_TOKEN   = eyJhbGciOi...
```

> Alternativa por terminal: `turso db create barbearia`,
> `turso db show barbearia --url` e `turso db tokens create barbearia`.

---

## Passo 2 - Enviar o codigo para o GitHub

Este projeto **ja vem com um repositorio Git local** (branch `main`) e o primeiro
commit feito. Se voce baixou o codigo em ZIP, rode antes:

```bash
git init
git branch -M main
git add .
git commit -m "Gestor de Barbearia - Nova Runtime"
```

Agora crie um repositorio **vazio** no GitHub (sem README, sem .gitignore) e envie:

```bash
git remote add origin https://github.com/SEU-USUARIO/gestor-de-barbearia.git
git push -u origin main
```

Confira antes de enviar: o arquivo `.gitignore` ja impede que
`node_modules/`, `data/`, `.env` e arquivos `*.db` subam para o GitHub.
**Nunca** coloque senhas ou tokens dentro do codigo.

> **Atualizacoes futuras:** depois de publicado, cada alteracao vira um commit e um
> `git push` — o Render republica sozinho:
>
> ```bash
> git add .
> git commit -m "Descricao da melhoria"
> git push
> ```


---

## Passo 3 - Criar o servico no Render

1. Acesse <https://render.com> e entre com a conta do GitHub.
2. Clique em **New +** > **Blueprint**.
3. Selecione o repositorio `gestor-de-barbearia`.
   O Render le o arquivo `render.yaml` que ja esta no projeto.
4. Ele vai pedir os valores das variaveis marcadas como secretas:
   - **TURSO_DATABASE_URL** - cole a URL do Passo 1.
   - **TURSO_AUTH_TOKEN** - cole o token do Passo 1.
   - **ADMIN_PASSWORD** - o Render gera uma senha forte sozinho. Depois de
     criar o servico, veja o valor em **Environment** e anote.
5. Clique em **Apply** / **Create**.
6. Aguarde o primeiro deploy (uns 2 a 5 minutos). O status deve ficar **Live**.

Pronto. O Render ja entrega:

- **HTTPS** automatico (certificado gerenciado);
- endereco gratuito no formato `https://gestor-de-barbearia-xxxx.onrender.com`;
- `healthCheckPath: /health`, que reinicia o servico se ele travar;
- deploy automatico a cada `git push` na branch `main`.

Se preferir criar sem o Blueprint, use **New + > Web Service** e preencha:

| Campo | Valor |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Plan | Free |

E cadastre manualmente as variaveis `NODE_ENV=production`, `HOST=0.0.0.0`,
`ADMIN_PASSWORD`, `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`.

---

## Passo 4 - Primeiro acesso

1. Abra `https://SEU-SERVICO.onrender.com` e entre com a senha do
   `ADMIN_PASSWORD`.
2. Va em **Configuracoes** e ajuste os dados da barbearia
   (nome, telefone, WhatsApp, endereco, Instagram), os **horarios de
   funcionamento** e as **folgas/feriados**.
3. Cadastre **Servicos** (nome, duracao e preco) e **Profissionais**.
   A agenda so libera horarios depois que existir pelo menos um servico e um
   profissional ativos.
4. Em **Configuracoes > Seguranca**, troque a senha por uma sua.
   O sistema exige no minimo 8 caracteres, com letras e numeros.

---

## Passo 5 - Link para os clientes agendarem pelo celular

Envie este endereco para seus clientes (funciona em qualquer celular):

```
https://SEU-SERVICO.onrender.com/agendar
```

Nessa pagina o cliente escolhe servico, profissional, dia e horario, informa
nome e telefone, e o sistema:

- bloqueia horarios ja ocupados (nao existe agendamento duplicado);
- respeita horarios de funcionamento, folgas, intervalo de almoco e o tempo
  minimo/maximo de antecedencia;
- gera um botao de **WhatsApp** com a mensagem de confirmacao ja escrita.

Para desativar o agendamento publico, use o interruptor em Configuracoes.

---

## Backups

O menu **Backup e dados** do painel permite:

- **Exportar**: baixa um arquivo `backup-barbearia-AAAA-MM-DD.json` com clientes,
  agendamentos, servicos, profissionais e configuracoes.
- **Importar**: restaura o arquivo no modo `merge` (atualiza sem apagar) ou
  `replace` (substitui tudo pelo conteudo do arquivo).
- **Verificar servidor**: mostra driver do banco, ambiente e tempo no ar.

Recomendacao: exporte o backup **toda semana** e guarde o arquivo em nuvem
(Google Drive, OneDrive). Isso e o seu seguro contra qualquer problema.

---

## Testes e verificacao

Na sua maquina, dentro do projeto:

```bash
npm install
npm test              # 121 verificacoes de API, seguranca e regras de negocio
npm run test:turso    # valida o driver libSQL e a persistencia entre reinicios
```

Os dois testes sobem um servidor de verdade em uma pasta temporaria e **nao
tocam no seu banco real**.

Depois de publicado, confira o health check no navegador:

```
https://SEU-SERVICO.onrender.com/health
```

A resposta esperada e parecida com:

```json
{ "status": "ok", "driver": "turso", "environment": "production", "uptime_seconds": 12 }
```

Se aparecer `"driver": "sqlite"` em producao, as variaveis do Turso nao foram
preenchidas - e os dados serao perdidos no proximo deploy.

---

## Limitacoes do plano gratuito (importante)

Numeros dos planos gratuitos no momento em que este guia foi escrito. Confirme
os valores atuais em <https://render.com/pricing> e <https://turso.tech/pricing>.

**Render (plano Free)**

- O servico **dorme apos 15 minutos sem acesso**. A primeira visita depois
  disso demora **cerca de um minuto** para responder (cold start), enquanto o
  Render mostra uma pagina de carregamento. O painel e a pagina de agendamento
  continuam funcionando, so demoram nessa primeira vez.
- Recursos modestos: cerca de **512 MB de RAM e 0,1 CPU**. Suficiente para uma
  barbearia, mas nao para dezenas de usuarios simultaneos.
- **Sem disco persistente** - por isso o banco fica no Turso.
- Cota de **750 horas de instancia por mes** (um servico ligado o mes inteiro
  cabe nessa cota) e **5 GB de trafego por mes**.
- **Dominio proprio** (`www.suabarbearia.com.br`) nao e o cenario do plano
  gratuito; o endereco gratuito `*.onrender.com` com HTTPS sim.
- Plataforma voltada a testes e projetos pessoais; para uso comercial intenso,
  o caminho natural e migrar para um plano pago (o codigo nao muda).

**Turso (plano gratuito)**

- **100 bancos**, **5 GB de armazenamento**, **500 milhoes de linhas lidas** e
  **10 milhoes de linhas gravadas** por mes. E muito mais do que uma barbearia
  consome no dia a dia, e nao exige cartao de credito.
- Restauracao point-in-time de 1 dia no plano gratuito.
- Nota: em outubro de 2026 o Turso anunciou a sua aquisicao pela Supabase e
  informou que o servico continua operando normalmente. Vale acompanhar o
  anuncio oficial e, por seguranca, manter o **backup JSON** em dia.


**Dicas praticas para conviver com isso**

- Mantenha o servico acordado com um monitor gratuito (ex.: UptimeRobot ou
  cron-job.org) chamando `https://SEU-SERVICO.onrender.com/health` a cada 10
  minutos. Isso evita a espera de cold start.
- Faca um **backup semanal** pelo painel e guarde o JSON fora do Render.
- Nao compartilhe a senha do painel. A pagina `/agendar` e publica, mas as
  APIs do painel exigem login e possuem limite de tentativas contra forca bruta.

---

## Problemas comuns

| Sintoma | Provavel causa | Solucao |
| --- | --- | --- |
| Deploy falha no build | `package.json` corrompido ou Node antigo | Verifique `engines.node >= 22.5.0` e rode `npm install` local |
| `/health` responde 503 | Banco inacessivel | Revise `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` |
| `"driver": "sqlite"` em producao | Variaveis do Turso vazias | Preencha as duas variaveis e faca novo deploy |
| Dados sumiram apos deploy | Estava usando SQLite no Render | Configure o Turso e reimporte o ultimo backup |
| Painel nao aceita a senha | `ADMIN_PASSWORD` diferente do esperado | Veja o valor em Environment ou troque a senha pelo painel |
| Primeira visita muito lenta | Cold start do plano gratuito | Normal; use o monitor de uptime citado acima |
