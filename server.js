const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'inscripciones.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambiar-esta-clave';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function leerDatos() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function guardarDatos(datos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(datos, null, 2));
}

function validarAdmin(req, res, next) {
  const clave = String(req.headers['x-admin-key'] || '').trim();
  const adminReal = String(ADMIN_KEY || '').trim();

  if (!clave || clave !== adminReal) {
    return res.status(401).json({ error: 'Clave de administrador incorrecta' });
  }

  next();
}

function escapeCsv(valor) {
  const texto = String(valor ?? '');
  if (texto.includes(',') || texto.includes('"') || texto.includes('\n')) {
    return '"' + texto.replace(/"/g, '""') + '"';
  }
  return texto;
}

app.post('/api/admin/login', validarAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/inscripciones', (req, res) => {
  res.json(leerDatos());
});

app.post('/api/inscripciones', (req, res) => {
  const { nombre, opcion } = req.body;

  if (!nombre || !opcion) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const limpio = String(nombre).trim();
  const opcionesValidas = ['churrasco', 'pulpo', 'ambos'];

  if (!limpio) {
    return res.status(400).json({ error: 'El nombre no puede estar vacío' });
  }

  if (!opcionesValidas.includes(opcion)) {
    return res.status(400).json({ error: 'Opción no válida' });
  }

  const datos = leerDatos();
  const registro = {
    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
    nombre: limpio,
    asistencia: 'Sí',
    comida: opcion,
    opcion,
    fecha: new Date().toISOString()
  };

  datos.push(registro);
  guardarDatos(datos);
  res.status(201).json({ ok: true, registro });
});

app.delete('/api/admin/inscripciones/:id', validarAdmin, (req, res) => {
  const { id } = req.params;
  const datos = leerDatos();
  const filtrados = datos.filter(item => item.id !== id);

  if (filtrados.length === datos.length) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  guardarDatos(filtrados);
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', validarAdmin, (req, res) => {
  const datos = leerDatos();
  const filas = datos.map(item => [
    escapeCsv(item.nombre),
    escapeCsv(item.asistencia || 'Sí'),
    escapeCsv(item.comida || item.opcion || '')
  ].join(','));

  const csv = ['nombre,asistencia,comida', ...filas].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inscripciones.csv"');
  res.send(csv);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});
