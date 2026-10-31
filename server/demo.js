// Modo demonstracao do Gestor de Barbearia.
//
// Cria um conjunto de dados FICTICIOS para apresentar o sistema (portfolio,
// demonstracao para clientes e testes manuais) sem usar nenhuma informacao real.
//
// Como funciona:
//   - a variavel de ambiente DEMO_MODE=1 ativa o modo;
//   - o banco padrao passa a ser "data/demo.db" (veja scripts/demo.mjs), separado
//     do banco real, portanto nada e sobrescrito;
//   - o seed so roda quando o banco esta vazio (a menos que use { force: true });
//   - a interface exibe o selo "MODO DEMONSTRACAO".

import { batch, get, run, setSetting } from './db.js';
import { addDays, hhmmToMinutes, minutesToHHMM, todayISO, weekdayOf } from './time.js';

export function isDemoMode() {
  return String(process.env.DEMO_MODE || '') === '1';
}

const DEMO_SETTINGS = {
  shop_name: 'Barbearia Dom Navalha (Demo)',
  shop_company: 'Cortes & Barba Tradicional',
  shop_phone: '(11) 98765-4321',
  shop_whatsapp: '5511987654321',
  shop_address: 'Rua Augusta, 1420 - Consolação - São Paulo',
  shop_instagram: '@domnavalha.barber',
  public_booking: '1',
};

const DEMO_SERVICES = [
  { name: 'Corte Clássico', description: 'Tesoura e máquina com acabamento na navalha.', duration_min: 30, price: 45 },
  { name: 'Corte + Barboterapia', description: 'Corte completo com barba na navalha e toalha quente.', duration_min: 60, price: 80 },
  { name: 'Barboterapia Tradicional', description: 'Modelagem de barba com hidratação, toalha quente e óleo.', duration_min: 30, price: 45 },
  { name: 'Degradê / Fade Navalhado', description: 'Degradê na régua com acabamento na navalha.', duration_min: 45, price: 60 },
  { name: 'Pigmentação de Barba/Cabelo', description: 'Correção de falhas e realce do desenho.', duration_min: 30, price: 55 },
  { name: 'Corte Kids', description: 'Atendimento com calma e paciência para os pequenos.', duration_min: 30, price: 40 },
];

const DEMO_BARBERS = [
  { name: 'Rafael Alves', phone: '(11) 98000-0001', email: 'rafael.alves@barbearia.com', color: '#c8a24a', commission: 40 },
  { name: 'Bruno Martins', phone: '(11) 98000-0002', email: 'bruno.martins@barbearia.com', color: '#5b8def', commission: 50 },
  { name: 'Diego Souza', phone: '(11) 98000-0003', email: 'diego.souza@barbearia.com', color: '#43b581', commission: 35 },
];

const DEMO_CLIENTS = [
  'Lucas Oliveira', 'Rodrigo Santos', 'Gabriel Silva', 'Matheus Costa',
  'Felipe Almeida', 'Guilherme Ferreira', 'Thiago Lima', 'Fábio Souza',
  'Leonardo Ribeiro', 'Gustavo Barbosa', 'Marcelo Rocha', 'André Carvalho',
];

/**
 * Grade fixa de horarios por profissional. Os intervalos nao se sobrepoem
 * (folga minima de 45 min entre o fim de um e o inicio do outro) e ficam fora
 * do horario de almoco (12:00-13:00).
 */
const BARBER_SLOTS = [
  ['09:00', '10:45', '14:00', '15:45'],
  ['09:30', '11:15', '14:30', '16:15'],
  ['10:00', '13:30', '15:15', '17:00'],
];

const STATUS_CYCLE = ['completed', 'completed', 'confirmed', 'pending', 'confirmed', 'cancelled', 'no_show'];

/** Resto da divisao sempre positivo (offset pode ser negativo nos dias passados). */
function pick(list, index) {
  return list[((index % list.length) + list.length) % list.length];
}

async function isServiceTableEmpty() {
  const row = await get('SELECT COUNT(*) AS total FROM services', []);
  return Number(row?.total || 0) === 0;
}

export async function isDemoSeeded() {
  const row = await get('SELECT COUNT(*) AS total FROM clients', []);
  return Number(row?.total || 0) > 0;
}

/**
 * Popula o banco com dados ficticios.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ seeded: boolean, appointments: number }>}
 */
export async function seedDemoData({ force = false } = {}) {
  if (!force && !(await isServiceTableEmpty())) {
    return { seeded: false, appointments: 0 };
  }

  for (const [key, value] of Object.entries(DEMO_SETTINGS)) {
    await setSetting(key, value);
  }

  const services = [];
  for (const service of DEMO_SERVICES) {
    const info = await run(
      'INSERT INTO services (name, description, duration_min, price, active) VALUES (?, ?, ?, ?, 1)',
      [service.name, service.description, service.duration_min, service.price]
    );
    services.push({ id: Number(info.lastInsertRowid), ...service });
  }

  const barbers = [];
  for (const barber of DEMO_BARBERS) {
    const info = await run(
      'INSERT INTO barbers (name, phone, email, color, commission, active) VALUES (?, ?, ?, ?, ?, 1)',
      [barber.name, barber.phone, barber.email, barber.color, barber.commission]
    );
    const barberId = Number(info.lastInsertRowid);
    barbers.push({ id: barberId, ...barber });

    // Jornada de segunda a sabado, com pausa para almoco. Domingo nao trabalha.
    await batch(
      [1, 2, 3, 4, 5, 6].map((weekday) => ({
        sql: `INSERT INTO barber_hours (barber_id, weekday, is_working, start_time, end_time, break_start, break_end)
              VALUES (?, ?, 1, '09:00', '19:00', '12:00', '13:00')`,
        params: [barberId, weekday],
      }))
    );
  }

  const clients = [];
  DEMO_CLIENTS.forEach((name, index) => {
    clients.push({ name, phone: `119000000${String(index + 1).padStart(2, '0')}` });
  });
  for (const client of clients) {
    const info = await run(
      'INSERT INTO clients (name, phone, email, notes) VALUES (?, ?, ?, ?)',
      [
        client.name,
        client.phone,
        `${client.name.split(' ')[0].toLowerCase()}@exemplo.com`,
        'Cliente ficticio do modo demonstracao.',
      ]
    );
    client.id = Number(info.lastInsertRowid);
  }

  const today = todayISO();
  const appointments = [];

  // Dois dias atras ate nove dias a frente, pulando os domingos (loja fechada).
  for (let offset = -2; offset <= 9; offset += 1) {
    const date = addDays(today, offset);
    if (weekdayOf(date) === 0) continue;

    // Dias passados ficam como concluidos; hoje e futuro misturam os status.
    const statuses = offset < 0 ? ['completed'] : STATUS_CYCLE;

    barbers.forEach((barber, barberIndex) => {
      const slots = BARBER_SLOTS[barberIndex % BARBER_SLOTS.length];
      const howMany = offset < 0 ? 2 : 2 + ((offset + barberIndex) % 2);

      for (let pickIndex = 0; pickIndex < howMany; pickIndex += 1) {
        const startTime = pick(slots, offset + barberIndex + pickIndex);
        const service = pick(services, offset + barberIndex + pickIndex);
        const client = pick(clients, offset * 2 + barberIndex + pickIndex * 3);
        const endTime = minutesToHHMM(hhmmToMinutes(startTime) + service.duration_min);
        const status = pick(statuses, offset + barberIndex + pickIndex);

        appointments.push({
          sql: `INSERT INTO appointments
                  (client_id, barber_id, service_id, date, start_time, end_time, status, price, notes, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            client.id,
            barber.id,
            service.id,
            date,
            startTime,
            endTime,
            status,
            service.price,
            status === 'pending' ? 'Aguardando confirmacao.' : null,
            (offset + pickIndex) % 3 === 0 ? 'public' : 'admin',
          ],
        });
      }
    });
  }

  await batch(appointments);
  return { seeded: true, appointments: appointments.length };
}
