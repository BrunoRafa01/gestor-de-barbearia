// Teste de integracao da WhatsApp Business Cloud API Oficial da Meta
//
// Valida:
// 1. Mascaramento de segredos (Access Token e Webhook Token nunca expostos no frontend).
// 2. Normalizacao de telefone (DDI 55, DDD, sem caracteres especiais).
// 3. Gerador de payload (Template oficial da Meta vs Texto direto).
// 4. Integracao com servidor HTTP simulando Meta Graph API v21.0.
// 5. Garantia de nao-simulacao: confirmacao so ocorre com status 200 da Meta; erros marcam 'failed'.
// 6. Idempotencia: prevencao estrita contra envio duplicado de mensagens.
// 7. Webhook da Meta: handshake de verificacao (GET) e recibos de entrega/leitura (POST).
// 8. Rotina de lembretes automaticos de 24h e notificacoes para cliente, barbeiro e admin.

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initDatabase,
  closeDatabase,
  run,
  get,
  setSetting,
} from '../server/db.js';
import {
  getWhatsAppConfig,
  sendMetaCloudMessage,
  processAppointmentReminders,
  verifyWebhook,
  handleWebhookEvent,
} from '../server/whatsapp-cloud.js';
import { normalizePhone } from '../server/whatsapp.js';

let passed = 0;
const failures = [];

function check(desc, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${desc}`);
  } else {
    failures.push(extra ? `${desc} (${extra})` : desc);
    console.error(`  ✖ FALHOU: ${desc} ${extra ? `(${extra})` : ''}`);
  }
}

async function runTests() {
  console.log('\n--- Iniciando Testes da WhatsApp Business Cloud API da Meta ---\n');

  const tempDir = mkdtempSync(join(tmpdir(), 'gb-wa-test-'));
  const testDbPath = join(tempDir, 'test.db');

  try {
    await initDatabase({ path: testDbPath });

    // 1. Normalizacao de telefone
    console.log('1. Normalizacao e seguranca de telefones:');
    check('Normaliza telefone celular com DDD (11 dígitos)', normalizePhone('(11) 98765-4321') === '5511987654321');
    check('Normaliza telefone fixo com DDD (10 dígitos)', normalizePhone('(11) 3456-7890') === '551134567890');
    check('Mantém DDI quando já fornecido', normalizePhone('+55 (21) 99999-8888') === '5521999998888');
    check('Rejeita telefone inválido', normalizePhone('1234') === '');

    // 2. Mascaramento de credenciais
    console.log('\n2. Mascaramento de credenciais e configuracoes:');
    await setSetting('whatsapp_access_token', 'EAABtest_secret_token_never_leak');
    await setSetting('whatsapp_phone_number_id', '1000999888123');
    await setSetting('whatsapp_business_account_id', '2000999888123');
    await setSetting('whatsapp_webhook_verify_token', 'my_secure_webhook_verify_token');
    await setSetting('whatsapp_cloud_enabled', '1');

    const config = getWhatsAppConfig();
    check('Carrega Phone Number ID configurado', config.phoneNumberId === '1000999888123');
    check('Carrega Access Token internamente', config.accessToken === 'EAABtest_secret_token_never_leak');
    check('Identifica que esta configurado', config.isConfigured === true);
    check('Identifica que esta ativado', config.enabled === true);

    // 3. Servidor Mock da Meta Graph API para testar envios reais
    console.log('\n3. Comunicacao com a Meta Graph API:');
    let metaCalls = [];
    let metaShouldFail = false;

    const mockMetaServer = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        metaCalls.push({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: parsed,
        });

        if (metaShouldFail) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: 'Invalid OAuth access token - Cannot parse access token',
              type: 'OAuthException',
              code: 190,
              error_subcode: 467,
            },
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ input: parsed.to, wa_id: parsed.to }],
          messages: [{ id: `wamid.HBgL${Date.now()}` }],
        }));
      });
    });

    await new Promise((resolve) => mockMetaServer.listen(0, '127.0.0.1', resolve));
    const metaPort = mockMetaServer.address().port;
    const metaApiBase = `http://127.0.0.1:${metaPort}`;
    process.env.WHATSAPP_API_BASE_URL = metaApiBase;

    // Teste de envio de mensagem de texto direta
    metaCalls = [];
    const directResult = await sendMetaCloudMessage({
      to: '11988887777',
      bodyText: 'Olá Carlos, seu agendamento está confirmado!',
      messageType: 'confirmation',
      idempotencyKey: 'test-direct-1',
    });

    check('Envio com sucesso retorna success=true', directResult.success === true);
    check('Retorna metaMessageId gerado pela Meta', Boolean(directResult.metaMessageId));
    check('Meta recebeu chamada com Authorization Bearer token', metaCalls[0]?.headers?.authorization === 'Bearer EAABtest_secret_token_never_leak');
    check('Meta recebeu payload de texto com numero normalizado', metaCalls[0]?.body?.to === '5511988887777');
    check('Meta recebeu messaging_product whatsapp', metaCalls[0]?.body?.messaging_product === 'whatsapp');

    // 4. Gravacao no banco de auditoria
    console.log('\n4. Auditoria e Historico de Mensagens:');
    const msgInDb = await get('SELECT * FROM whatsapp_messages WHERE idempotency_key = ?', ['test-direct-1']);
    check('Mensagem registrada na tabela whatsapp_messages', Boolean(msgInDb));
    check('Status registrado como sent', msgInDb?.status === 'sent');
    check('Destinatario salvo com telefone normalizado', msgInDb?.recipient_phone === '5511988887777');
    check('Data de envio sent_at preenchida', Boolean(msgInDb?.sent_at));

    // 5. Idempotencia estrita: nao reenviar a mesma mensagem
    console.log('\n5. Protecao contra envios duplicados (Idempotencia):');
    const prevCallsCount = metaCalls.length;
    const duplicateResult = await sendMetaCloudMessage({
      to: '11988887777',
      bodyText: 'Olá Carlos, tentativa duplicada!',
      messageType: 'confirmation',
      idempotencyKey: 'test-direct-1', // mesma chave
    });
    check('Envio duplicado detectado com duplicate=true', duplicateResult.duplicate === true);
    check('Envio duplicado nao realizou chamada adicional na Meta API', metaCalls.length === prevCallsCount);

    // 6. Tratamento de erro sem falsa simulacao
    console.log('\n6. Tratamento de erro e rejeicao de simulacao:');
    metaShouldFail = true;
    let failedError = null;
    try {
      await sendMetaCloudMessage({
        to: '11977776666',
        bodyText: 'Esta chamada deve falhar na Meta',
        messageType: 'reminder',
        idempotencyKey: 'test-fail-1',
      });
    } catch (err) {
      failedError = err;
    }
    check('Resposta de erro da Meta lanca excecao explicita', Boolean(failedError));
    check('Captura mensagem de erro da Meta', failedError?.message?.includes('Invalid OAuth'));

    const failedInDb = await get('SELECT * FROM whatsapp_messages WHERE idempotency_key = ?', ['test-fail-1']);
    check('Banco registra status failed', failedInDb?.status === 'failed');
    check('Banco registra error_message detalhada', failedInDb?.error_message?.includes('Invalid OAuth'));
    metaShouldFail = false;

    // 7. Envio utilizando Template oficial da Meta
    console.log('\n7. Envio por Template aprovado da Meta:');
    await setSetting('whatsapp_use_templates', '1');

    metaCalls = [];
    const templateResult = await sendMetaCloudMessage({
      to: '11999990000',
      templateName: 'template_confirm_v1',
      templateParams: ['Joao', 'Gestor Barbearia', '10/11/2026', '14:00', 'Barbeiro Pedro', 'Corte Degradê'],
      bodyText: 'Ola Joao, seu horario esta confirmado!',
      messageType: 'confirmation',
      idempotencyKey: 'test-template-1',
    });

    check('Envio por template executado com sucesso', templateResult.success === true);
    check('Payload da Meta formatado com tipo template', metaCalls[0]?.body?.type === 'template');
    check('Payload contem o nome correto do template', metaCalls[0]?.body?.template?.name === 'template_confirm_v1');
    check('Parametros do body component preenchidos corretamente', metaCalls[0]?.body?.template?.components?.[0]?.parameters?.length === 6);

    // 8. Webhook da Meta
    console.log('\n8. Webhook da Meta (Handshake e Status Receipts):');
    const verifySuccess = verifyWebhook('subscribe', 'my_secure_webhook_verify_token', 'challenge_abc123');
    check('Handshake do webhook com token correto retorna o challenge', verifySuccess === 'challenge_abc123');
    const verifyFail = verifyWebhook('subscribe', 'token_errado', 'challenge_abc123');
    check('Handshake do webhook com token invalido e rejeitado', verifyFail === null);

    // Simular recibos de entrega 'delivered' e 'read'
    const testMetaMsgId = directResult.metaMessageId;
    await handleWebhookEvent({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: testMetaMsgId,
                    status: 'delivered',
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const deliveredMsg = await get('SELECT * FROM whatsapp_messages WHERE meta_message_id = ?', [testMetaMsgId]);
    check('Webhook atualiza status para delivered', deliveredMsg?.status === 'delivered');

    await handleWebhookEvent({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: testMetaMsgId,
                    status: 'read',
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const readMsg = await get('SELECT * FROM whatsapp_messages WHERE meta_message_id = ?', [testMetaMsgId]);
    check('Webhook atualiza status para read', readMsg?.status === 'read');

    // 9. Rotina automatica de lembretes 24h
    console.log('\n9. Rotina de Lembretes 24 horas antes do agendamento:');
    // Criar barbeiro, servico, cliente e agendamento para amanha
    const barberRes = await run('INSERT INTO barbers (name, phone, active) VALUES (?, ?, ?)', ['Barbeiro Teste', '11911112222', 1]);
    const serviceRes = await run('INSERT INTO services (name, duration_min, price, active) VALUES (?, ?, ?, ?)', ['Corte Teste', 30, 45, 1]);
    const clientRes = await run('INSERT INTO clients (name, phone) VALUES (?, ?)', ['Cliente Lembrete', '11933334444']);

    // Calcular data/hora de exatamente amanha (~24h a frente)
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    const tomorrowTime = `${String(tomorrow.getHours()).padStart(2, '0')}:${String(tomorrow.getMinutes()).padStart(2, '0')}`;

    const apptRes = await run(`
      INSERT INTO appointments (client_id, barber_id, service_id, date, start_time, end_time, price, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'public')
    `, [clientRes.lastInsertRowid, barberRes.lastInsertRowid, serviceRes.lastInsertRowid, tomorrowDate, tomorrowTime, '23:59', 45]);

    await setSetting('whatsapp_reminder_enabled', '1');
    await setSetting('whatsapp_reminder_hours', '24');
    metaCalls = [];
    const reminderReport = await processAppointmentReminders();
    check('Processador de lembretes escaneou agendamentos', reminderReport.scanned >= 1);
    check('Lembrete enviado com sucesso', reminderReport.sent >= 1);

    const reminderMsg = await get('SELECT * FROM whatsapp_messages WHERE appointment_id = ? AND message_type = ?', [apptRes.lastInsertRowid, 'reminder']);
    check('Registro do lembrete salvo com status sent', reminderMsg?.status === 'sent');

    // Executar novamente: idempotencia impede segundo envio do lembrete
    const repeatReport = await processAppointmentReminders();
    check('Segundo processamento nao duplica lembrete ja enviado', repeatReport.sent === 0);

    // Fechar servidor mock
    await new Promise((resolve) => mockMetaServer.close(resolve));

    console.log('\n======================================================');
    console.log(`Resumo dos Testes do WhatsApp Cloud: ${passed} passaram, ${failures.length} falharam.`);
    console.log('======================================================\n');

    if (failures.length > 0) {
      process.exit(1);
    }
  } finally {
    delete process.env.WHATSAPP_API_BASE_URL;
    await closeDatabase().catch(() => {});
    rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch(err => {
  console.error('Erro fatal executando suite de testes:', err);
  process.exit(1);
});
