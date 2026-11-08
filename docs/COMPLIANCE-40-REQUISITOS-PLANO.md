# Plano de Implementação: 40 Requisitos de Segurança, Compliance LGPD & Transparência

> **Para agentes executores:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Cada etapa usa sintaxe de checkbox (`- [ ]`) para rastreamento.

**Objetivo:** Implementar de ponta a ponta os 40 requisitos de segurança da informação, conformidade LGPD/CDC, transparência comercial e DevSecOps em ambos os projetos (`gestor-de-barbearia` e `nova-short`), com interfaces interativas, endpoints funcionais, testes automatizados e envio ao GitHub.

**Arquitetura:**
- **Módulo de Segurança e Governança:** Rate Limiting robusto, RBAC estrito, sanitização XSS, prevenção SQLi, anonimização de IP para logs, auditoria contínua de segurança (SecOps) e RFC 9116 (`security.txt`).
- **Módulo LGPD & Titulares (DSR):** Consent Management Platform (CMP) interativa com categorias granulares, portal de requisição dos direitos do titular, exportação de dados em JSON (portabilidade) e rotina de retenção/expurgo.
- **Módulo CDC & Transparência:** Políticas de Termos de Uso, Privacidade, Cookies, Reembolso (CDC Art. 49), Cancelamento transparente de assinaturas, Identificação do fornecedor, Licença de uso e Transparência sobre IA.
- **Automação & Auditoria:** Scripts executáveis de auditoria de conformidade dos 40 requisitos (`npm run compliance:audit`) que validam cada controle com evidências e geram relatório.

**Tech Stack:**
- **Projeto 1 (`gestor-de-barbearia`):** Node.js, Express, SQLite/Turso, Vanilla JS PWA, Tailwind/CSS.
- **Projeto 2 (`nova-short`):** Next.js 15, React 19, TypeScript, Prisma ORM, Redis/BullMQ, Tailwind CSS.

---

## Mapeamento dos 40 Requisitos

| # | Requisito | Categoria | Entregável Técnico |
|---|---|---|---|
| 01 | Autenticação de Segurança | Segurança | Sessões seguras, tokens criptográficos, timing-safe compare |
| 02 | Controle de Acesso (RBAC) | Segurança | Middleware de permissões (admin, user, public) |
| 03 | Criptografia de Dados | Segurança | Criptografia AES-256-GCM para PII e bcrypt work factor 12 |
| 04 | HTTPS/TLS | Segurança | HSTS, cookies Secure; HttpOnly; SameSite=Strict |
| 05 | Rotina de Senhas | Segurança | Validação de entropia, complexidade e rotação de senhas |
| 06 | SQL Injection | Segurança | Queries estritamente parametrizadas / ORM sem concatenação |
| 07 | XSS (Cross-Site Scripting) | Segurança | Sanitização de inputs, headers CSP e escape automático |
| 08 | Rotina de Limite | Segurança | Rate limiting multi-nível com HTTP 429 & Retry-After |
| 09 | Proteção de IP | Privacidade/Sec | Anonimização de IP em logs (`XXX.XXX.***.***`) e detecção de spoofing |
| 10 | Auditoria de Dependências | SecOps | Script automatizado `npm run audit:deps` e verificação de CVEs |
| 11 | Política de Privacidade | LGPD | Página interativa e documento completo conforme Lei 13.709/2018 |
| 12 | Bases Legais | LGPD | Mapeamento explícito das bases legais (Art. 7 LGPD) na UI e docs |
| 13 | Minimização de Dados | LGPD | Coleta estritamente necessária, eliminação de metadados inúteis |
| 14 | Finalidade de Documentos | LGPD | Declaração clara e avisos de finalidade para CPF, telefone e email |
| 15 | Gestão de Consentimentos | LGPD | Cookie Banner interativo (CMP) com granularidade e revogação |
| 16 | Política de Cookies | LGPD | Página dedicada listando finalidade, domínio e duração de cada cookie |
| 17 | Direitos dos Titulares (DSR) | LGPD | Formulário e API de solicitação (acesso, exclusão, correção) |
| 18 | Execução de Dados / Portabilidade | LGPD | Endpoint e botão de exportação completa dos dados em JSON |
| 19 | Retenção de Dados | LGPD | Política de ciclo de vida e script de expurgo automático de dados |
| 20 | Contratos dos Operadores | LGPD | DPA detalhando subprocessadores (Vercel, Supabase, Cloudflare, etc.) |
| 21 | Termo de Uso | CDC / Legal | Termos de Serviço completos e acessíveis via rota dedicada |
| 22 | Transparência de Preço | CDC | Tabela clara de preços, sem taxas ocultas, plano gratuito vs pro |
| 23 | Cobrança de Transparência | CDC | Avisos de renovação, faturas claras e políticas de cobrança |
| 24 | Cancelamento de Assinaturas | CDC | Fluxo de cancelamento em 1 clique, sem padrões escuros (dark patterns) |
| 25 | Política de Reembolso | CDC | Direito de arrependimento (Art. 49 CDC - 7 dias) e prazos |
| 26 | Identificação do Fornecedor | CDC | CNPJ, Razão Social, endereço físico e suporte no rodapé |
| 27 | Publicidade Transparente | CDC | Identificação clara de links patrocinados e conteúdo promocional |
| 28 | Depoimentos Autênticos | CDC | Diretrizes e selo de avaliações verificadas |
| 29 | Licença de Uso | CDC / EULA | Termos de licença de software e restrições de uso |
| 30 | Transparência sobre IA | IA / Éthica | Notificação de algoritmos de automação/IA e limites de uso |
| 31 | Backups Automáticos | SecOps | Scripts de backup criptografado do banco com retenção |
| 32 | Logins Seguros | Segurança | Proteção anti-força bruta, timing-attack prevention, sessão segura |
| 33 | Monitoramento de Segurança | SecOps | Logger de eventos de segurança (falhas de auth, 403, exportações) |
| 34 | Resposta ao Incidente (IRP) | Governança | Plano de resposta a incidentes (triagem, contenção, erradicação) |
| 35 | Notificação de Incidente | Governança | Protocolo de notificação à ANPD e aos titulares em até 48h |
| 36 | Teste de Segurança | QA / SecOps | Suíte de testes automatizados cobrindo os vetores de segurança |
| 37 | Segurança de Código | DevSecOps | Headers de segurança (HSTS, CSP, X-Frame, X-Content-Type) |
| 38 | Privilégio Administrativo | Segurança | Princípio do menor privilégio, MFA e trilha de auditoria admin |
| 39 | Gestão de Vulnerabilidade | SecOps | RFC 9116 `security.txt` e canal de divulgação responsável |
| 40 | Auditoria de Conformidade | Governança | Script executável e relatório de validação dos 40 requisitos |

---

## Tarefas de Execução

### Fase 1: Implementação no Projeto `gestor-de-barbearia`
- [ ] **Tarefa 1.1:** Módulos de Segurança no Backend (`security.js`, `auth.js`, `routes/lgpd.js`, `routes/compliance.js`).
- [ ] **Tarefa 1.2:** Páginas e Componentes de Governança (`/termos.html`, `/privacidade.html`, `/cookies.html`, `/compliance.html`, Banner de Consentimento CMP).
- [ ] **Tarefa 1.3:** RFC 9116 `security.txt` e scripts de backup / retenção de dados.
- [ ] **Tarefa 1.4:** Suíte de Testes e Script de Auditoria dos 40 Requisitos (`scripts/compliance-audit.mjs`).
- [ ] **Tarefa 1.5:** Executar verificação, commit e push para o repositório GitHub `BrunoRafa01/gestor-de-barbearia`.

### Fase 2: Implementação no Projeto `nova-short`
- [ ] **Tarefa 2.1:** Módulos de Segurança e Conformidade no Backend (`src/lib/security/compliance.ts`, `src/app/api/lgpd/`).
- [ ] **Tarefa 2.2:** Páginas de Conformidade Next.js (`/termos`, `/privacidade`, `/cookies`, `/transparencia`, `/compliance`).
- [ ] **Tarefa 2.3:** Componente Interativo de Consentimento (`CookieConsentBanner.tsx`), Portabilidade e DSR.
- [ ] **Tarefa 2.4:** RFC 9116 `public/.well-known/security.txt` e rotinas de backup.
- [ ] **Tarefa 2.5:** Suíte de Testes e Script de Auditoria dos 40 Requisitos (`tests/compliance-40.test.ts` e `scripts/compliance-audit.ts`).
- [ ] **Tarefa 2.6:** Executar build, testes, commit e push para o repositório GitHub `BrunoRafa01/Nova-Short`.

### Fase 3: Validação Final e Relatório
- [ ] **Tarefa 3.1:** Executar os scripts de auditoria em ambos os projetos para comprovar 100% de conformidade.
- [ ] **Tarefa 3.2:** Gerar relatório consolidado com os 40 requisitos e links dos commits.
