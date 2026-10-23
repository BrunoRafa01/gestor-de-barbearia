// Inicia o Gestor de Barbearia em MODO DEMONSTRACAO.
//
//   npm run demo
//
// - Usa um banco separado ("data/demo.db") para nao misturar com dados reais.
//   Se TURSO_DATABASE_URL estiver definida, o modo demo usa esse banco.
// - Cria automaticamente barbeiros, servicos, clientes e agendamentos ficticios.
// - A interface mostra o selo "MODO DEMONSTRACAO".

process.env.DEMO_MODE = process.env.DEMO_MODE ?? '1';

if (!process.env.TURSO_DATABASE_URL && !process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = 'data/demo.db';
}

await import('../server/server.js');
