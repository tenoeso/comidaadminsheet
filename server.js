const express = require('express');
const path = require('path');
const { google } = require('googleapis');

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Hoja 1';

app.use(express.json());
app.use(express.static(__dirname));

function comprobarConfiguracion() {
  const faltan = [
    'GOOGLE_SHEET_ID',
    'GOOGLE_SHEET_NAME',
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_PRIVATE_KEY'
  ].filter(nombre => !process.env[nombre]);

  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  }
}

function obtenerSheets() {
  comprobarConfiguracion();

  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({
    version: 'v4',
    auth
  });
}

function adminCorrecto(req) {
  const claveEnviada = String(
    req.headers['x-admin-key'] || ''
  ).trim();

  return Boolean(ADMIN_KEY) &&
    claveEnviada === ADMIN_KEY.trim();
}

function exigirAdmin(req, res, next) {
  if (!adminCorrecto(req)) {
    return res.status(401).json({
      error: 'Clave de administrador incorrecta'
    });
  }

  next();
}

async function asegurarCabecera() {
  const sheets = obtenerSheets();

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:E1`
  });

  const valores = respuesta.data.values || [];

  if (valores.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:E1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          'id',
          'nombre',
          'asistencia',
          'comida',
          'fecha'
        ]]
      }
    });
  }
}

async function leerInscripciones() {
  const sheets = obtenerSheets();

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`
  });

  const filas = respuesta.data.values || [];

  return filas
    .slice(1)
    .filter(fila => fila.some(valor => valor))
    .map((fila, indice) => ({
      id: fila[0] || `fila-${indice + 2}`,
      nombre: fila[1] || '',
      asistencia: fila[2] || 'Sí',
      comida: fila[3] || '',
      opcion: fila[3] || '',
      fecha: fila[4] || ''
    }));
}

function escaparCsv(valor) {
  const texto = String(valor ?? '');

  if (
    texto.includes(',') ||
    texto.includes('"') ||
    texto.includes('\n')
  ) {
    return `"${texto.replace(/"/g, '""')}"`;
  }

  return texto;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/admin/login', exigirAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/inscripciones', async (req, res) => {
  try {
    const datos = await leerInscripciones();
    res.json(datos);
  } catch (error) {
    console.error('Error leyendo Google Sheets:', error);

    res.status(500).json({
      error: `No se pudo leer Google Sheets: ${error.message}`
    });
  }
});

app.post('/api/inscripciones', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const opcion = String(req.body.opcion || '').trim();

    const opcionesValidas = [
      'churrasco',
      'pulpo',
      'ambos'
    ];

    if (!nombre) {
      return res.status(400).json({
        error: 'El nombre es obligatorio'
      });
    }

    if (!opcionesValidas.includes(opcion)) {
      return res.status(400).json({
        error: 'La opción de comida no es válida'
      });
    }

    await asegurarCabecera();

    const registro = [
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nombre,
      'Sí',
      opcion,
      new Date().toISOString()
    ];

    const sheets = obtenerSheets();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [registro]
      }
    });

    res.status(201).json({
      ok: true,
      mensaje: 'Inscripción guardada en Google Sheets'
    });
  } catch (error) {
    console.error('Error escribiendo Google Sheets:', error);

    res.status(500).json({
      error: `No se pudo guardar en Google Sheets: ${error.message}`
    });
  }
});

app.delete(
  '/api/admin/inscripciones/:id',
  exigirAdmin,
  async (req, res) => {
    try {
      const datos = await leerInscripciones();

      const indice = datos.findIndex(
        item => item.id === req.params.id
      );

      if (indice === -1) {
        return res.status(404).json({
          error: 'Usuario no encontrado'
        });
      }

      const sheets = obtenerSheets();

      const informacion = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets.properties'
      });

      const hoja = informacion.data.sheets.find(
        item => item.properties.title === SHEET_NAME
      );

      if (!hoja) {
        return res.status(404).json({
          error: `No existe la pestaña "${SHEET_NAME}"`
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: hoja.properties.sheetId,
                  dimension: 'ROWS',
                  startIndex: indice + 1,
                  endIndex: indice + 2
                }
              }
            }
          ]
        }
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Error borrando inscripción:', error);

      res.status(500).json({
        error: `No se pudo borrar: ${error.message}`
      });
    }
  }
);

app.get(
  '/api/admin/export.csv',
  exigirAdmin,
  async (req, res) => {
    try {
      const datos = await leerInscripciones();

      const filas = datos.map(item => [
        escaparCsv(item.nombre),
        escaparCsv(item.asistencia),
        escaparCsv(item.comida)
      ].join(','));

      const csv = [
        'nombre,asistencia,comida',
        ...filas
      ].join('\n');

      res.setHeader(
        'Content-Type',
        'text/csv; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="inscripciones.csv"'
      );

      res.send(csv);
    } catch (error) {
      res.status(500).json({
        error: `No se pudo generar el CSV: ${error.message}`
      });
    }
  }
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
