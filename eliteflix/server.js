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
const __dirname = path.dirname(__filename);
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

// Utils
const pesosToCents = n => Math.round(Number(n) * 100);
const safe = t => sanitizeHtml(t || '', { allowedTags: [], allowedAttributes: {} });
const logo = domain => `https://logo.clearbit.com/${domain}`;

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
    // ✅ CORREGIDA esta línea
    const plantilla = `Cuenta: ${name} | Periodo: ${period} | Usuario: {{email}} | Contraseña: (se enviará por correo o en esta pantalla)`;
    ins.run(name, pesosToCents(price), period, category, logo_url, plantilla);
  }
};
seedProducts();

// Helper de Layout
const originalRender = app.response.render;
app.response.render = function (view, options = {}, cb) {
  options.layout = (name) => { options._layoutFile = name };
  options.body = '';
  const self = this;
  ejs.renderFile(path.join(__dirname, 'views', view + '.ejs'), { ...options }, (err, str) => {
    if (err) return originalRender.call(self, view, options, cb);
    if (options._layoutFile) {
      options.body = str;
      return ejs.renderFile(path.join(__dirname, 'views', options._layoutFile + '.ejs'), { ...options }, (e, str2) => {
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

// Setup inicial (abierto solo si no hay admin)
const hasAdmin = () => db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get().c > 0;

app.get('/admin/setup', (req, res) => {
  if (hasAdmin()) return res.redirect('/');
  res.render('admin/setup', { title: 'Configuración inicial — Éliteflix' });
});

app.post('/admin/setup', (req, res) => {
  if (hasAdmin()) return res.redirect('/');
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send('Datos inválidos');
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users(email,password_hash,role,points) VALUES(?,?,?,0)').run(email, hash, 'admin');
    return res.redirect('/admin/login');
  } catch (e) {
    console.error(e);
    return res.status(400).send('No se pudo crear el admin');
  }
});

// Auth admin
app.get('/admin/login', (req, res) => {
  if (!hasAdmin()) return res.redirect('/admin/setup');
  res.render('admin/login', { title: 'Iniciar sesión — Admin' });
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=? AND role="admin"').get(safe(email));
  if (!u) return res.status(401).send('<script>alert("No autorizado");window.location="/admin/login"</script>');
  const ok = bcrypt.compareSync(password, u.password_hash);
  if (!ok) return res.status(401).send('<script>alert("Credenciales inválidas");window.location="/admin/login"</script>');
  req.session.admin = { id: u.id, email: u.email };
  res.redirect('/admin/dashboard');
});

app.post('/admin/logout', (req, res) => {
  req.session.admin = null;
  res.redirect('/');
});

const requireAdmin = (req, res, next) => {
  if (req.session?.admin) return next();
  return res.redirect('/admin/login');
};

// Rutas públicas
app.get('/', (req, res) => {
  const logos = db.prepare('SELECT name, logo_url FROM products WHERE active=1 LIMIT 12').all();
  res.render('landing', { title: 'Éliteflix — Inicio', logos });
});

// Catálogo cliente (público por ahora)
app.get('/catalogo', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1').all();
  res.render('client/catalog', { title: 'Catálogo — Éliteflix', products });
});

// Admin
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users WHERE role="client"').get().c,
    sales: db.prepare('SELECT IFNULL(SUM(price_cents),0) as t FROM orders').get().t || 0,
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c
  };
  res.render('admin/dashboard', { title: 'Panel de Administración — Éliteflix', stats });
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'No encontrado — Éliteflix' });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Éliteflix listo en el puerto ${PORT}`);
});
