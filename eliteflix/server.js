// ... (tu encabezado actual queda igual)
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

// Esquema base
db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'client',
    points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price_cents INTEGER,
    period TEXT,
    category TEXT,
    logo_url TEXT,
    active INTEGER DEFAULT 1,
    details_template TEXT
  );
  CREATE TABLE IF NOT EXISTS orders(
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    product_id INTEGER,
    price_cents INTEGER,
    status TEXT,
    credentials TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
`);

// ===== Migraciones suaves (no rompen si ya existen) =====
const tryAlter = (sql) => { try { db.prepare(sql).run(); } catch { /* ya existía */ } };

// users: datos de perfil y saldo
tryAlter(ALTER TABLE users ADD COLUMN first_name TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN last_name TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN country TEXT;);
tryAlter(ALTER TABLE users ADD COLUMN balance_cents INTEGER DEFAULT 0;);

// orders: fechas para mostrar renovaciones
tryAlter(ALTER TABLE orders ADD COLUMN start_date TEXT;);
tryAlter(ALTER TABLE orders ADD COLUMN end_date   TEXT;);

// soporte
db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subject TEXT,
    message TEXT,
    status TEXT DEFAULT 'abierto',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Utils
const pesosToCents = (n) => Math.round(Number(n) * 100);
const centsToPesos = (c) => (Number(c || 0) / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const safe = (t) => sanitizeHtml(t || '', { allowedTags: [], allowedAttributes: {} });
const logo = (domain) => https://logo.clearbit.com/${domain};

// Seed productos (igual que ya tenías; dejo ejemplo corto)
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

// Helper de Layout (igual al tuyo)
const originalRender = app.response.render;
app.response.render = function (view, options = {}, cb) {
  options.layout = (name) => { options._layoutFile = name; };
  options.body = '';
  const self = this;
  ejs.renderFile(path.join(__dirname, 'views', view + '.ejs'), { ...options, centsToPesos }, (err, str) => {
    if (err) return originalRender.call(self, view, options, cb);
    if (options._layoutFile) {
      options.body = str;
      return ejs.renderFile(path.join(__dirname, 'views', options._layoutFile + '.ejs'), { ...options, centsToPesos }, (e, str2) => {
        if (e) return self.send(str);
        return self.send(str2);
      });
    }
    return self.send(str);
  });
};

// Sesión en vistas
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ===== Admin existente (setup, login, dashboard) =====
// (tu código actual aquí; no lo quito)

// ======= CLIENTES: Registro / Login / Perfil / Logout =======

// Mostrar registro
app.get('/registro', (req, res) => {
  if (req.session?.client) return res.redirect('/perfil');
  res.render('auth/register', { title: 'Crear cuenta — Éliteflix' });
});

// Guardar registro
app.post('/registro', (req, res) => {
  const { first_name, last_name, country, email, password } = req.body;
  if (!first_name || !last_name || !country || !email || !password) {
    return res.status(400).send('<script>alert("Completa todos los campos");window.location="/registro"</script>');
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(`
      INSERT INTO users(first_name,last_name,country,email,password_hash,role,balance_cents,points)
      VALUES(?,?,?,?,?,'client',0,0)
    `).run(safe(first_name), safe(last_name), safe(country), safe(email), hash);
    return res.redirect('/inicio');
  } catch (e) {
    console.error(e);
    return res.status(400).send('<script>alert("Ese correo ya existe o es inválido");window.location="/registro"</script>');
  }
});

// Login cliente
app.get('/inicio', (req, res) => {
  if (req.session?.client) return res.redirect('/perfil');
  res.render('auth/login', { title: 'Iniciar sesión — Éliteflix (Cliente)' });
});

app.post('/inicio', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=? AND role="client"').get(safe(email));
  if (!u) return res.status(401).send('<script>alert("Usuario no encontrado");window.location="/inicio"</script>');
  const ok = bcrypt.compareSync(password, u.password_hash);
  if (!ok) return res.status(401).send('<script>alert("Credenciales inválidas");window.location="/inicio"</script>');
  req.session.client = { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, country: u.country, balance_cents: u.balance_cents };
  res.redirect('/perfil');
});

// Logout cliente
app.post('/salir', (req, res) => {
  req.session.client = null;
  res.redirect('/');
});

// Middleware cliente
const requireClient = (req, res, next) => {
  if (req.session?.client) return next();
  return res.redirect('/inicio');
};

// Perfil cliente
app.get('/perfil', requireClient, (req, res) => {
  const client = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.client.id);

  // Pedimos órdenes con fechas si existen
  const orders = db.prepare(`
    SELECT o.id, o.start_date, o.end_date, o.status, p.name as product_name
    FROM orders o
    JOIN products p ON p.id = o.product_id
    WHERE o.user_id=?
    ORDER BY IFNULL(o.end_date, o.created_at) DESC
  `).all(client.id);

  res.render('client/profile', {
    title: 'Mi perfil — Éliteflix',
    client,
    orders,
    formatMoney: centsToPesos
  });
});

// Soporte (guardar ticket)
app.post('/soporte', requireClient, (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    return res.status(400).send('<script>alert("Completa asunto y mensaje");window.location="/perfil"</script>');
  }
  db.prepare(INSERT INTO support_tickets(user_id,subject,message) VALUES(?,?,?))
    .run(req.session.client.id, safe(subject), safe(message));
  res.redirect('/perfil');
});

// ===== Rutas públicas que ya tenías =====
app.get('/', (req, res) => {
  const logos = db.prepare('SELECT name, logo_url FROM products WHERE active=1 LIMIT 12').all();
  res.render('landing', { title: 'Éliteflix — Inicio', logos });
});

app.get('/catalogo', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1').all();
  res.render('client/catalog', { title: 'Catálogo — Éliteflix', products, formatMoney: centsToPesos });
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'No encontrado — Éliteflix' });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(✅ Éliteflix listo en el puerto ${PORT});
});
