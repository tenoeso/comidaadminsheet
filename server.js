const express = require('express');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambiar-esta-clave';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Inscripciones';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error('Faltan variables de entorno de Google Sheets');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function validarAdmin(req, res, next) {
  const clave = req.headers['x-admin-key'];
  if (!clave || clave !== ADMIN_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

async function asegurarHoja() {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const existe = (meta.data.sheets || []).some(
    s => s.properties && s.properties.title === SHEET_NAME
  );

  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: SHEET_NAME }
            }
          }
        ]
      }
    });
  }

  const encabezado = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:D1`
  });

  const fila = encabezado.data.values && encabezado.data.values[0];

  if (!fila || fila[0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:D1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          'id',
          'nombre',
          'opcion',
          'fecha'
        ]]
      }
    });
  }
}

async function leerDatos() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:D`
  });

  const rows = response.data.values || [];

  return rows.map(row => ({
    id: row[0] || '',
    nombre: row[1] || '',
    opcion: row[2] || '',
    fecha: row[3] || ''
  })).filter(item => item.id && item.nombre);
}

async function guardarRegistro(registro) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        registro.id,
        registro.nombre,
        registro.opcion,
        registro.fecha
      ]]
    }
  });
}

async function guardarTodos(datos) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:D`
  });

  if (!datos.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:D`,
    valueInputOption: 'RAW',
    requestBody: {
      values: datos.map(item => [
        item.id,
        item.nombre,
        item.opcion,
        item.fecha
      ])
    }
  });
}

app.get('/api/inscripciones', async (req, res) => {
  try {
    const datos = await leerDatos();
    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron cargar los datos' });
  }
});

app.post('/api/inscripciones', async (req, res) => {
  try {
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

    const registro = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      nombre: limpio,
      opcion,
      fecha: new Date().toISOString()
    };

    await guardarRegistro(registro);

    res.status(201).json({ ok: true, registro });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo guardar la inscripción' });
  }
});

app.delete('/api/admin/inscripciones/:id', validarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const datos = await leerDatos();
    const filtrados = datos.filter(item => item.id !== id);

    if (filtrados.length === datos.length) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await guardarTodos(filtrados);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo borrar la inscripción' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'Google Sheets no disponible' });
  }
});

asegurarHoja()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error inicializando Google Sheets:', error);
    process.exit(1);
  });
