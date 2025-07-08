// ==========================================================
//    PORTAL DE RESIDENTES
// ==========================================================

const SPREADSHEET_ID = '1sGh-wSzD9kw2xLwc-WA5saL46oZtpsHYH6QP57dZuMw'; 

const SHEETS = {
  RESIDENTES: { gid: 0 },
  VISITAS: { gid: 1409883976 },
  DEPARTAMENTOS: { gid: 1067842708 },
  CONFIGURACION: { gid: 34039155 },
  ESTACIONAMIENTOS: { gid: 227107705 },
  ENCOMIENDAS: { gid: 1197993248 },
  LAVANDERIA: { gid: 260781604 },
  ASCENSORES: { gid: 605301846 },
  MENSAJES: { gid: 837880582 } 
};

// --- SERVIDOR WEB ---
function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('Portal de Residentes')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  } catch (err) {
    console.error("Error crítico en doGet:", err);
    return HtmlService.createHtmlOutput(`<html><body><h1>Error del Servidor</h1><p>No se pudo cargar la aplicación.</p></body></html>`).setTitle("Error");
  }
}

// --- UTILIDADES OPTIMIZADAS ---
function _normalizeRut(rut) {
    if (!rut) return '';
    return rut.toString().toUpperCase().replace(/[.-]/g, '');
}

function _hashPassword(password, salt) {
  const saltedPassword = password + salt;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltedPassword);
  return hash.map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function _convertSheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data.shift().map(h => h ? h.trim() : '');
  return data.map((row, index) => {
    const obj = { _rowIndex: index + 2 };
    headers.forEach((header, i) => { if (header) obj[header] = row[i]; });
    return obj;
  });
}

// --- LÓGICA DE LOGIN Y MANEJO DE CONTRASEÑAS ---
function loginUser(rut, password) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByGid(SHEETS.RESIDENTES.gid);
    const todosResidentes = _convertSheetToObjects(sheet);
    if (todosResidentes.length === 0) return { success: false, error: "No se pueden cargar datos de residentes." };
    
    const normalizedRut = _normalizeRut(rut);
    const residente = todosResidentes.find(r => _normalizeRut(r.Rut) === normalizedRut);
    if (!residente) return { success: false, error: 'RUT o contraseña incorrectos.' };
    
    if (residente.PasswordHash && residente.PasswordSalt) {
        if (_hashPassword(password, residente.PasswordSalt) === residente.PasswordHash) {
            const token = Utilities.getUuid();
            CacheService.getScriptCache().put(token, residente.Rut, 1800);
            return { success: true, action: 'login', token: token };
        }
    } else {
        const rutDigits = normalizedRut.substring(0, normalizedRut.length - 1);
        if (password === rutDigits.substring(0, 6)) {
            const tempToken = Utilities.getUuid();
            CacheService.getScriptCache().put(`temp_${tempToken}`, residente.Rut, 300);
            return { success: true, action: 'force_change', tempToken: tempToken };
        }
    }
    return { success: false, error: 'RUT o contraseña incorrectos.' };
  } catch (e) {
    console.error("Error en loginUser:", e);
    return { success: false, error: `Error del servidor: ${e.message}` };
  }
}

function setNewPassword(tempToken, newPassword) {
    try {
        if (!tempToken || !newPassword) return { success: false, error: 'Datos incompletos.' };
        const cache = CacheService.getScriptCache();
        const rut = cache.get(`temp_${tempToken}`);
        if (!rut) return { success: false, error: 'La sesión para cambiar la contraseña ha expirado.' };
        
        cache.remove(`temp_${tempToken}`);
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByGid(SHEETS.RESIDENTES.gid);
        if (!sheet) throw new Error("No se pudo acceder a la hoja de Residentes.");
        
        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        const rutIndex = headers.indexOf("Rut");
        const hashIndex = headers.indexOf("PasswordHash");
        const saltIndex = headers.indexOf("PasswordSalt");

        if (hashIndex === -1 || saltIndex === -1) throw new Error("Columnas 'PasswordHash' o 'PasswordSalt' no encontradas.");
        
        const rowIndexInArray = data.findIndex(row => _normalizeRut(row[rutIndex]) === _normalizeRut(rut));
        if (rowIndexInArray === -1) return { success: false, error: 'No se encontró tu registro.' };

        const actualRowInSheet = rowIndexInArray + 2;
        const salt = Utilities.getUuid();
        const hash = _hashPassword(newPassword, salt);

        sheet.getRange(actualRowInSheet, hashIndex + 1).setValue(hash);
        sheet.getRange(actualRowInSheet, saltIndex + 1).setValue(salt);
        
        return { success: true, message: '¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión.' };
    } catch (e) {
        console.error("Error en setNewPassword:", e);
        return { success: false, error: e.message };
    }
}

// --- OBTENER DATOS DEL RESIDENTE (VERSIÓN OPTIMIZADA) ---
function getResidentDataWithToken(token) {
    try {
        if (!token) return { success: false, error: 'Sesión inválida.' };
        const cache = CacheService.getScriptCache();
        const rut = cache.get(token);
        if (!rut) return { success: false, error: 'Tu sesión ha expirado. Inicia sesión de nuevo.' };
        
        cache.put(token, rut, 1800);

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const allSheets = ss.getSheets();
        const findSheet = (gid) => allSheets.find(s => s.getSheetId() == gid);

        const todosResidentes = _convertSheetToObjects(findSheet(SHEETS.RESIDENTES.gid));
        const residenteActual = todosResidentes.find(r => r.Rut === rut);
        if (!residenteActual) return { success: false, error: 'No se pudo encontrar tu perfil.' };
        
        const configData = _convertSheetToObjects(findSheet(SHEETS.CONFIGURACION.gid));
        const config = {};
        configData.forEach(row => { if (row.Clave) config[row.Clave] = row.Valor; });

        const usosLavanderia = _convertSheetToObjects(findSheet(SHEETS.LAVANDERIA.gid)).filter(u => !u["Hora Termino"]);
        const estacionamientos = _convertSheetToObjects(findSheet(SHEETS.ESTACIONAMIENTOS.gid));
        
        const servicios = {
            ascensores: _convertSheetToObjects(findSheet(SHEETS.ASCENSORES.gid)),
            lavadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Lavadora').length,
            secadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Secadora').length,
            estacionamientos: { total: estacionamientos.length, ocupados: estacionamientos.filter(e => String(e.Ocupado).toUpperCase() === 'SI').length }
        };

        const encomiendas = _convertSheetToObjects(findSheet(SHEETS.ENCOMIENDAS.gid)).filter(e => e.Torre == residenteActual.Torre && e.Departamento == residenteActual.Departamento && String(e.Estado).toUpperCase() === 'PENDIENTE');
        const visitas = _convertSheetToObjects(findSheet(SHEETS.VISITAS.gid)).filter(v => v.Torre == residenteActual.Torre && v.Departamento == residenteActual.Departamento).sort((a, b) => b.ID - a.ID).slice(0, 20);
        const mensajes = _convertSheetToObjects(findSheet(SHEETS.MENSAJES.gid)).filter(m => {
            if (!m.Destinatario) return false;
            const dest = m.Destinatario.toUpperCase();
            return dest === 'TODOS' || dest === `T${residenteActual.Torre}` || dest === `T${residenteActual.Torre}-${residenteActual.Departamento}` || dest === _normalizeRut(residenteActual.Rut);
        }).sort((a, b) => b.ID - a.ID);
        
        return { success: true, data: { perfil: residenteActual, servicios, encomiendas, visitas, mensajes, config }};
    } catch (e) {
        console.error("Error en getResidentDataWithToken:", e);
        return { success: false, error: `Error cargando datos: ${e.message}` };
    }
}