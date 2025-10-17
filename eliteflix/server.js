import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import ejs from 'ejs';

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);
const app = express();

// Seguridad y middlewares
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'eliteflix-secret',
  resave: false,
  saveUninitialized: false,
}));

// DB
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const db = new Database(path.join(dataDir, 'eliteflix.db'));

// ===== Migraciones suaves =====
const tryAlter = (sql) => { try { db.prepare(sql).run(); } catch { /* ya existía */ } };

tryAlter(ALTER TABLE users ADD COLUMN first_name TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN last_name TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN country TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN balance_cents INTEGER DEFAULT 0;);

tryAlter(ALTER TABLE orders ADD COLUMN start_date TEXT;);
tryAlter(ALTER TABLE orders ADD COLUMN end_date TEXT;);

// Utils
const pesosToCents = (n) => Math.round(Number(n) * 100);
const centsToPesos = (c) => (Number(c || 0) / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const safe = (t) => sanitizeHtml(t || '', { allowedTags: [], allowedAttributes: {} });
const logo = (domain) => https://logo.clearbit.com/${domain};

// Seed productos
const seedProducts = () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count > 0) return;
  const items = [
    ['Netflix', 90, '1M', 'Streaming', logo('netflix.com')],
    ['Disney+', 85, '1M', 'Streaming', logo('disneyplus.com')],
    ['HBO Max', 65, '1M', 'Streaming', logo('max.com')],
    ['Prime Video', 65, '1M', 'Streaming', logo('amazon.com')],
    ['Spotify', 70, '1M', 'Música', logo('spotify.com')],
    ['YouTube Premium', 75, '1M', 'Video', logo('youtube.com')],
  ];
  const ins = db.prepare(`
    INSERT INTO products(name,price_cents,period,category,logo_url,active,details_template)
    VALUES(?,?,?,?,?,1,?)
  `);
  for (const it of items) {
    const [name, price, period, category, logo_url] = it;
    const plantilla = Cuenta: ${name} | Periodo: ${period} | Usuario: {{email}} | Contraseña: (se enviará por correo o en esta pantalla);
    ins.run(name, pesosToCents(price), period, category, logo_url, plantilla);
  }
};
seedProducts();

// Soporte
app.post('/soporte', (req, res) => {
  db.prepare(INSERT INTO support_tickets(user_id,subject,message) VALUES(?,?,?))
    .run(1, 'Asunto', 'Mensaje');
  res.send('Soporte guardado');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(✅ Éliteflix listo en el puerto ${PORT});
});
