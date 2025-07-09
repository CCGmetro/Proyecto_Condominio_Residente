//==========================================================
//    PORTAL DE RESIDENTES - BACKEND (v14 - Mejorado y Completo)
// ==========================================================

// IDs PRINCIPALES
const SPREADSHEET_ID = '1lbioS5LjgsjJSSn_e8LUKusa0RGKXdDesfHrUG7-zJI';
const FOTOS_FOLDER_ID = '1aYj5zToE3SrFN-X9oo_aDM0ij-F2HrI0';
const LOGS_FOLDER_ID = '1eYoDgpzGdhLnN2nTUumMrf-s8jd_VAyE'; 

// GIDs DE LAS HOJAS (con validación)
const SHEETS = {
  RESIDENTES: { gid: 0, name: 'Residentes' },
  VISITAS: { gid: 1409883976, name: 'Visitas' },
  DEPARTAMENTOS: { gid: 1067842708, name: 'Departamentos' },
  CONFIGURACION: { gid: 34039155, name: 'Configuración' },
  ESTACIONAMIENTOS: { gid: 227107705, name: 'Estacionamientos' },
  ENCOMIENDAS: { gid: 1197993248, name: 'Encomiendas' },
  LAVANDERIA: { gid: 260781604, name: 'Lavandería' },
  ASCENSORES: { gid: 605301846, name: 'Ascensores' },
  MENSAJES: { gid: 837880582, name: 'Mensajes' },
  RECUPERACION: { gid: 1247789216, name: 'Recuperación' } 
};

// Cache de 30 minutos (1800 segundos)
const CACHE_EXPIRATION = 1800;
const TEMP_CACHE_EXPIRATION = 300;

// --- SERVIDOR WEB ---
function doGet(e) {
  try {
    // Registrar acceso
    logActivity('Acceso a la aplicación', {ip: e.queryString});
    
    const template = HtmlService.createTemplateFromFile('Index');
    template.cacheTime = 0; // Desactiva cache para desarrollo
    return template.evaluate()
      .setTitle('Portal de Residentes')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    console.error("Error en doGet:", err);
    logError('Error en doGet', err);
    return HtmlService.createHtmlOutput(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h1 style="color: #dc3545;">Error del Servidor</h1>
          <p>No se pudo cargar la aplicación. Por favor, inténtalo más tarde.</p>
          <p><small>${err.message}</small></p>
        </body>
      </html>
    `).setTitle("Error");
  }
}

// --- LOGGING Y AUDITORÍA ---
function logActivity(action, details = {}) {
  try {
    const logSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Logs') || 
                     SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet('Logs');
    
    // Si es la primera fila, agregar encabezados
    if (logSheet.getLastRow() === 0) {
      logSheet.appendRow(['Fecha', 'Hora', 'Acción', 'Detalles', 'Usuario']);
    }
    
    const now = new Date();
    const user = Session.getActiveUser().getEmail() || 'Anónimo';
    
    logSheet.appendRow([
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'),
      action,
      JSON.stringify(details),
      user
    ]);
    
    // También guardar en archivo de texto en Drive
    const logFolder = DriveApp.getFolderById(LOGS_FOLDER_ID);
    const logFileName = `logs_${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd')}.txt`;
    let logFile;
    
    try {
      logFile = logFolder.getFilesByName(logFileName).next();
    } catch (e) {
      logFile = logFolder.createFile(logFileName, '');
    }
    
    logFile.setContent(logFile.getBlob().getDataAsString() + 
      `[${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')}] ${action} - ${user}\n${JSON.stringify(details, null, 2)}\n\n`);
    
  } catch (e) {
    console.error("Error al registrar actividad:", e);
  }
}

function logError(context, error) {
  logActivity(`ERROR: ${context}`, {
    error: error.toString(),
    stack: error.stack
  });
}

// --- UTILIDADES MEJORADAS ---
function _normalizeRut(rut) {
    if (!rut) return '';
    // Elimina puntos, guiones y espacios, y convierte a mayúsculas
    return rut.toString().replace(/[.\-\s]/g, '').toUpperCase();
}

function _validateRut(rut) {
    if (!rut) return false;
    const cleanRut = _normalizeRut(rut);
    if (cleanRut.length < 2) return false;
    
    const rutDigits = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);
    
    if (!/^[0-9]+$/.test(rutDigits)) return false;
    
    // Cálculo del DV esperado
    let sum = 0;
    let multiplier = 2;
    
    for (let i = rutDigits.length - 1; i >= 0; i--) {
        sum += parseInt(rutDigits.charAt(i)) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    
    const expectedDv = 11 - (sum % 11);
    const calculatedDv = expectedDv === 11 ? '0' : expectedDv === 10 ? 'K' : expectedDv.toString();
    
    return calculatedDv === dv.toUpperCase();
}

function _hashPassword(password, salt) {
  if (!password || !salt) return '';
  const saltedPassword = password + salt;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltedPassword, Utilities.Charset.UTF_8);
  return hash.map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function _generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Función optimizada para convertir hojas a objetos con caché
 */
function _convertSheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  
  const cacheKey = `sheet_${sheet.getSheetId()}_${sheet.getLastRow()}_${sheet.getLastColumn()}`;
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    return JSON.parse(cachedData);
  }
  
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data.shift().map(h => h ? h.toString().trim() : '');
  
  const result = data.map((row, index) => {
    const obj = { _rowIndex: index + 2 };
    headers.forEach((header, i) => { 
      if (header) obj[header] = row[i] !== undefined ? row[i] : null;
    });
    return obj;
  });
  
  cache.put(cacheKey, JSON.stringify(result), CACHE_EXPIRATION);
  return result;
}

// --- MANEJO DE ARCHIVOS ---
function getLogoUrl() {
  try {
    const folder = DriveApp.getFolderById(FOTOS_FOLDER_ID);
    const files = folder.getFilesByName('LogoCDA.jpg');
    
    if (files.hasNext()) {
      const file = files.next();
      logActivity('Logo cargado', {fileId: file.getId()});
      return file.getUrl();
    }
    
    return null;
  } catch (e) {
    console.error("Error al obtener logo:", e);
    logError('Error al obtener logo', e);
    return null;
  }
}

function getResidentPhotoUrl(rut) {
  if (!rut) {
    console.error("Error: RUT no proporcionado");
    return null;
  }

  try {
    // Elimina espacios en blanco que podrían causar problemas
    const cleanRut = rut.toString().trim();
    console.log(`Buscando foto para RUT exacto: ${cleanRut}`);
    
    const folder = DriveApp.getFolderById(FOTOS_FOLDER_ID);
    
    // 1. Primera búsqueda: Nombre exacto "12.345.678-9.jpg"
    const exactFileName = cleanRut + ".jpg";
    const exactFile = folder.getFilesByName(exactFileName);
    
    if (exactFile.hasNext()) {
      const file = exactFile.next();
      console.log(`Encontrado por nombre exacto: ${exactFileName}`);
      return "https://drive.google.com/uc?export=view&id=" + file.getId();
    }
    
    // 2. Segunda búsqueda: "12.345.678-9" (sin extensión)
    const exactFileWithoutExt = folder.getFilesByName(cleanRut);
    if (exactFileWithoutExt.hasNext()) {
      const file = exactFileWithoutExt.next();
      console.log(`Encontrado por nombre sin extensión: ${cleanRut}`);
      return "https://drive.google.com/uc?export=view&id=" + file.getId();
    }
    
    // 3. Búsqueda flexible si las anteriores fallan
    console.log("No se encontró coincidencia exacta, realizando búsqueda flexible...");
    const files = folder.getFiles();
    let fileCount = 0;
    
    while (files.hasNext()) {
      fileCount++;
      const file = files.next();
      const fileName = file.getName();
      
      // Compara eliminando espacios y cambiando a minúsculas
      if (fileName.trim().toLowerCase() === exactFileName.toLowerCase()) {
        console.log(`Coincidencia flexible encontrada: ${fileName}`);
        return "https://drive.google.com/uc?export=view&id=" + file.getId();
      }
    }
    
    console.log(`No se encontró foto. Archivos revisados: ${fileCount}`);
    return null;
  } catch (e) {
    console.error("Error en getResidentPhotoUrl:", e);
    return null;
  }
}

// --- LÓGICA DE LOGIN MEJORADA ---
function loginUser(rut, password) {
  try {
    // Validación básica de entrada
    if (!rut || !password) {
      logActivity('Intento de login sin credenciales', {rut: rut});
      return { success: false, error: "RUT y contraseña son requeridos." };
    }
    
    // Validación de RUT
    if (!_validateRut(rut)) {
      logActivity('Intento de login con RUT inválido', {rut: rut});
      return { success: false, error: "El RUT ingresado no es válido." };
    }
    
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    if (!sheet) {
      logError('Hoja de residentes no encontrada', new Error('Hoja no encontrada'));
      return { success: false, error: "Error al acceder a los datos de residentes." };
    }
    
    const todosResidentes = _convertSheetToObjects(sheet);
    if (todosResidentes.length === 0) {
      logError('No hay residentes registrados', new Error('Sin datos'));
      return { success: false, error: "No se encontraron residentes registrados." };
    }
    
    const normalizedRut = _normalizeRut(rut);
    const residente = todosResidentes.find(r => _normalizeRut(r.Rut) === normalizedRut);
    
    if (!residente) {
      // Retraso intencional para evitar timing attacks
      Utilities.sleep(500);
      logActivity('Intento de login con RUT no registrado', {rut: rut});
      return { success: false, error: 'RUT o contraseña incorrectos.' };
    }
    
    // Verificación de contraseña
    if (residente.PasswordHash && residente.PasswordSalt) {
      // Usuario con contraseña establecida
      const hashAttempt = _hashPassword(password, residente.PasswordSalt);
      if (hashAttempt === residente.PasswordHash) {
        const token = Utilities.getUuid();
        CacheService.getScriptCache().put(token, residente.Rut, CACHE_EXPIRATION);
        
        logActivity('Login exitoso', {rut: rut, method: 'password'});
        return { 
          success: true, 
          action: 'login', 
          token: token,
          userData: {
            nombre: residente.Nombre,
            torre: residente.Torre,
            depto: residente.Departamento,
            rut: residente.Rut,
            correo: residente.Correo,
            fono: residente.Fono
          }
        };
      }
    } else {
      // Usuario sin contraseña (primer acceso)
      const rutDigits = normalizedRut.substring(0, normalizedRut.length - 1);
      if (password === rutDigits.substring(0, 6)) {
        const tempToken = Utilities.getUuid();
        CacheService.getScriptCache().put(`temp_${tempToken}`, residente.Rut, TEMP_CACHE_EXPIRATION);
        
        logActivity('Primer acceso - Cambio de contraseña requerido', {rut: rut});
        return { 
          success: true, 
          action: 'force_change', 
          tempToken: tempToken,
          userRut: residente.Rut
        };
      }
    }
    
    Utilities.sleep(500); // Retraso para evitar timing attacks
    logActivity('Intento de login con credenciales incorrectas', {rut: rut});
    return { success: false, error: 'RUT o contraseña incorrectos.' };
    
  } catch (e) {
    console.error("Error en loginUser:", e);
    logError('Error en loginUser', e);
    return { 
      success: false, 
      error: 'Error en el servidor. Por favor, inténtalo más tarde.' 
    };
  }
}

function setNewPassword(tempToken, newPassword) {
    try {
        // Validaciones de entrada
        if (!tempToken || !newPassword || newPassword.length < 6) {
            logActivity('Intento de cambio de contraseña con datos inválidos', {tempToken: !!tempToken, passLength: newPassword?.length});
            return { 
                success: false, 
                error: 'La contraseña debe tener al menos 6 caracteres.' 
            };
        }
        
        const cache = CacheService.getScriptCache();
        const rut = cache.get(`temp_${tempToken}`);
        
        if (!rut) {
            logActivity('Intento de cambio de contraseña con token expirado', {tempToken: tempToken});
            return { 
                success: false, 
                error: 'La sesión para cambiar la contraseña ha expirado. Por favor, inicia sesión nuevamente.' 
            };
        }
        
        cache.remove(`temp_${tempToken}`);
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
        
        if (!sheet) {
            throw new Error("No se pudo acceder a la hoja de Residentes.");
        }
        
        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        const rutIndex = headers.indexOf("Rut");
        const hashIndex = headers.indexOf("PasswordHash");
        const saltIndex = headers.indexOf("PasswordSalt");

        if (hashIndex === -1 || saltIndex === -1) {
            throw new Error("Configuración incompleta en la hoja de Residentes.");
        }
        
        const rowIndexInArray = data.findIndex(row => _normalizeRut(row[rutIndex]) === _normalizeRut(rut));
        if (rowIndexInArray === -1) {
            logActivity('Residente no encontrado al cambiar contraseña', {rut: rut});
            return { 
                success: false, 
                error: 'No se encontró tu registro. Contacta al administrador.' 
            };
        }

        const actualRowInSheet = rowIndexInArray + 2;
        const salt = Utilities.getUuid();
        const hash = _hashPassword(newPassword, salt);

        sheet.getRange(actualRowInSheet, hashIndex + 1).setValue(hash);
        sheet.getRange(actualRowInSheet, saltIndex + 1).setValue(salt);
        
        // Limpiar caché de residentes
        const cacheKey = `sheet_${sheet.getSheetId()}_${sheet.getLastRow()}_${sheet.getLastColumn()}`;
        CacheService.getScriptCache().remove(cacheKey);
        
        logActivity('Contraseña cambiada exitosamente', {rut: rut, method: 'first-time'});
        return { 
            success: true, 
            message: '¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión con tu nueva contraseña.' 
        };
    } catch (e) {
        console.error("Error en setNewPassword:", e);
        logError('Error en setNewPassword', e);
        return { 
            success: false, 
            error: 'Error al actualizar la contraseña. Por favor, inténtalo nuevamente.' 
        };
    }
}

// --- OBTENER DATOS DEL RESIDENTE (OPTIMIZADO CON CACHÉ) ---
function getResidentDataWithToken(token) {
    try {
        if (!token) {
            logActivity('Intento de acceso sin token', {token: token});
            return { 
                success: false, 
                error: 'Sesión inválida. Por favor, inicia sesión nuevamente.' 
            };
        }
        
        const cache = CacheService.getScriptCache();
        const rut = cache.get(token);
        
        if (!rut) {
            logActivity('Intento de acceso con token expirado', {token: token});
            return { 
                success: false, 
                error: 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.' 
            };
        }
        
        // Renovar el token
        cache.put(token, rut, CACHE_EXPIRATION);
        
        // Intentar obtener datos del caché primero
        const cacheKey = `resident_data_${rut}`;
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return { 
                success: true, 
                data: JSON.parse(cachedData) 
            };
        }
        
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        
        // Obtener datos del residente
        const residentesSheet = ss.getSheetByName(SHEETS.RESIDENTES.name);
        if (!residentesSheet) {
            throw new Error("No se encontró la hoja de Residentes.");
        }
        
        const todosResidentes = _convertSheetToObjects(residentesSheet);
        const residenteActual = todosResidentes.find(r => _normalizeRut(r.Rut) === _normalizeRut(rut));
        
        if (!residenteActual) {
            logActivity('Residente no encontrado al cargar datos', {rut: rut});
            return { 
                success: false, 
                error: 'No se pudo encontrar tu perfil. Contacta al administrador.' 
            };
        }
        
        // Obtener foto del residente
        const fotoUrl = getResidentPhotoUrl(rut);
        if (fotoUrl) {
            residenteActual.FotoUrl = fotoUrl;
        }
        
        // Obtener configuración
        const configSheet = ss.getSheetByName(SHEETS.CONFIGURACION.name);
        const configData = _convertSheetToObjects(configSheet);
        const config = {};
        configData.forEach(row => { 
            if (row.Clave) config[row.Clave] = row.Valor; 
        });
        
        // Obtener logo del condominio
        const logoUrl = getLogoUrl();
        if (logoUrl) {
            config.LogoUrl = logoUrl;
        }
        
        // Obtener datos de servicios
        const servicesData = {};
        const sheetNames = [
            'ASCENSORES', 'LAVANDERIA', 'ESTACIONAMIENTOS', 
            'ENCOMIENDAS', 'VISITAS', 'MENSAJES'
        ];
        
        sheetNames.forEach(sheetName => {
            const sheet = ss.getSheetByName(SHEETS[sheetName].name);
            servicesData[sheetName.toLowerCase()] = sheet ? _convertSheetToObjects(sheet) : [];
        });
        
        // Procesar datos
        const usosLavanderia = servicesData.lavanderia.filter(u => !u["Hora Termino"]);
        
        const servicios = {
            ascensores: servicesData.ascensores,
            lavadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Lavadora').length,
            secadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Secadora').length,
            estacionamientos: {
                total: servicesData.estacionamientos.length,
                ocupados: servicesData.estacionamientos.filter(e => String(e.Ocupado).toUpperCase() === 'SI').length
            }
        };
        
        // Filtrar encomiendas y visitas por torre y departamento
        const encomiendas = servicesData.encomiendas.filter(e => 
            e.Torre == residenteActual.Torre && 
            e.Departamento == residenteActual.Departamento && 
            String(e.Estado).toUpperCase() === 'PENDIENTE'
        );
        
        const visitas = servicesData.visitas
            .filter(v => v.Torre == residenteActual.Torre && v.Departamento == residenteActual.Departamento)
            .sort((a, b) => (b.ID || 0) - (a.ID || 0))
            .slice(0, 20);
            
        // Filtrar mensajes por destinatario
        const mensajes = servicesData.mensajes
            .filter(m => {
                if (!m.Destinatario) return false;
                const dest = m.Destinatario.toUpperCase();
                return dest === 'TODOS' || 
                       dest === `T${residenteActual.Torre}` || 
                       dest === `T${residenteActual.Torre}-${residenteActual.Departamento}` || 
                       dest === _normalizeRut(residenteActual.Rut);
            })
            .sort((a, b) => {
                const dateA = new Date(`${a.Fecha || '1970-01-01'} ${a.Hora || '00:00'}`);
                const dateB = new Date(`${b.Fecha || '1970-01-01'} ${b.Hora || '00:00'}`);
                return dateB - dateA;
            });
        
        // Preparar respuesta
        const responseData = { 
            perfil: residenteActual, 
            servicios, 
            encomiendas, 
            visitas, 
            mensajes, 
            config 
        };
        
        // Almacenar en caché
        cache.put(cacheKey, JSON.stringify(responseData), 300); // 5 minutos de caché
        
        logActivity('Datos de residente cargados', {rut: rut});
        return { 
            success: true, 
            data: responseData 
        };
        
    } catch (e) {
        console.error("Error en getResidentDataWithToken:", e);
        logError('Error en getResidentDataWithToken', e);
        return { 
            success: false, 
            error: 'Error al cargar los datos. Por favor, inténtalo más tarde.' 
        };
    }
}

// --- FUNCIÓN PARA CAMBIO DE CONTRASEÑA VOLUNTARIO ---
function changePassword(rut, currentPassword, newPassword) {
    try {
        // Validaciones
        if (!rut || !currentPassword || !newPassword || newPassword.length < 6) {
            logActivity('Intento de cambio de contraseña con datos inválidos', {rut: rut, passLength: newPassword?.length});
            return { 
                success: false, 
                error: 'Todos los campos son requeridos y la nueva contraseña debe tener al menos 6 caracteres.' 
            };
        }
        
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
        if (!sheet) {
            logError('Hoja de residentes no encontrada', new Error('Hoja no encontrada'));
            return { 
                success: false, 
                error: 'Error al acceder a los datos.' 
            };
        }
        
        const residentes = _convertSheetToObjects(sheet);
        const residente = residentes.find(r => _normalizeRut(r.Rut) === _normalizeRut(rut));
        
        if (!residente) {
            logActivity('Residente no encontrado al cambiar contraseña', {rut: rut});
            return { 
                success: false, 
                error: 'Residente no encontrado.' 
            };
        }
        
        // Verificar contraseña actual
        const hashAttempt = _hashPassword(currentPassword, residente.PasswordSalt);
        if (hashAttempt !== residente.PasswordHash) {
            Utilities.sleep(500); // Prevenir timing attacks
            logActivity('Intento de cambio de contraseña con credencial incorrecta', {rut: rut});
            return { 
                success: false, 
                error: 'La contraseña actual es incorrecta.' 
            };
        }
        
        // Actualizar contraseña
        const data = sheet.getDataRange().getValues();
        const headers = data.shift();
        const rutIndex = headers.indexOf("Rut");
        const hashIndex = headers.indexOf("PasswordHash");
        const saltIndex = headers.indexOf("PasswordSalt");
        
        const rowIndex = data.findIndex(row => _normalizeRut(row[rutIndex]) === _normalizeRut(rut));
        if (rowIndex === -1) {
            logActivity('Fila no encontrada al cambiar contraseña', {rut: rut});
            return { 
                success: false, 
                error: 'No se pudo actualizar la contraseña.' 
            };
        }

        const actualRow = rowIndex + 2;
        const newSalt = Utilities.getUuid();
        const newHash = _hashPassword(newPassword, newSalt);

        sheet.getRange(actualRow, hashIndex + 1).setValue(newHash);
        sheet.getRange(actualRow, saltIndex + 1).setValue(newSalt);
        
        // Limpiar caché
        const cacheKey = `sheet_${sheet.getSheetId()}_${sheet.getLastRow()}_${sheet.getLastColumn()}`;
        CacheService.getScriptCache().remove(cacheKey);
        
        logActivity('Contraseña cambiada exitosamente', {rut: rut, method: 'voluntary'});
        return { 
            success: true, 
            message: 'Contraseña actualizada correctamente.' 
        };
    } catch (e) {
        console.error("Error en changePassword:", e);
        logError('Error en changePassword', e);
        return { 
            success: false, 
            error: 'Error al cambiar la contraseña. Por favor, inténtalo de nuevo.' 
        };
    }
}

// --- RECUPERACIÓN DE CONTRASEÑA ---
function requestPasswordReset(rut, email) {
    try {
        if (!rut || !email) {
            return { 
                success: false, 
                error: 'RUT y correo electrónico son requeridos.' 
            };
        }
        
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
        if (!sheet) {
            return { 
                success: false, 
                error: 'Error al acceder a los datos.' 
            };
        }
        
        const residentes = _convertSheetToObjects(sheet);
        const residente = residentes.find(r => 
            _normalizeRut(r.Rut) === _normalizeRut(rut) && 
            r.Correo && r.Correo.toLowerCase() === email.toLowerCase()
        );
        
        if (!residente) {
            // Retraso para evitar timing attacks
            Utilities.sleep(500);
            return { 
                success: false, 
                error: 'No se encontró un residente con ese RUT y correo electrónico.' 
            };
        }
        
        // Generar token temporal
        const token = Utilities.getUuid();
        const expiration = new Date();
        expiration.setHours(expiration.getHours() + 1); // Válido por 1 hora
        
        // Guardar en hoja de recuperación
        const recoverySheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RECUPERACION.name) || 
                             SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(SHEETS.RECUPERACION.name);
        
        if (recoverySheet.getLastRow() === 0) {
            recoverySheet.appendRow(['Rut', 'Token', 'Expiración']);
        }
        
        recoverySheet.appendRow([
            _normalizeRut(rut),
            token,
            Utilities.formatDate(expiration, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
        ]);
        
        // Enviar correo electrónico (simulado)
        const resetLink = `https://script.google.com/macros/s/${ScriptApp.getScriptId()}/exec?resetToken=${token}`;
        
        // En producción, usar MailApp o GmailApp para enviar el correo real
        console.log(`Enlace de recuperación para ${email}: ${resetLink}`);
        
        return { 
            success: true, 
            message: 'Se ha enviado un enlace de recuperación a tu correo electrónico.' 
        };
        
    } catch (e) {
        console.error("Error en requestPasswordReset:", e);
        return { 
            success: false, 
            error: 'Error al procesar la solicitud. Por favor, inténtalo de nuevo.' 
        };
    }
}

function resetPasswordWithToken(token, newPassword) {
    try {
        if (!token || !newPassword || newPassword.length < 6) {
            return { 
                success: false, 
                error: 'Token inválido o contraseña demasiado corta.' 
            };
        }
        
        const recoverySheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RECUPERACION.name);
        if (!recoverySheet || recoverySheet.getLastRow() < 2) {
            return { 
                success: false, 
                error: 'Token no válido o expirado.' 
            };
        }
        
        const now = new Date();
        const data = recoverySheet.getDataRange().getValues();
        const headers = data.shift();
        
        const rutIndex = headers.indexOf('Rut');
        const tokenIndex = headers.indexOf('Token');
        const expirationIndex = headers.indexOf('Expiración');
        
        const row = data.find(row => row[tokenIndex] === token);
        
        if (!row) {
            return { 
                success: false, 
                error: 'Token no válido o expirado.' 
            };
        }
        
        const expiration = new Date(row[expirationIndex]);
        if (now > expiration) {
            return { 
                success: false, 
                error: 'El token ha expirado. Por favor, solicita uno nuevo.' 
            };
        }
        
        const rut = row[rutIndex];
        
        // Actualizar contraseña
        const residentesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
        if (!residentesSheet) {
            throw new Error("No se pudo acceder a la hoja de Residentes.");
        }
        
        const residentesData = residentesSheet.getDataRange().getValues();
        const residentesHeaders = residentesData.shift();
        
        const residenteRutIndex = residentesHeaders.indexOf("Rut");
        const hashIndex = residentesHeaders.indexOf("PasswordHash");
        const saltIndex = residentesHeaders.indexOf("PasswordSalt");

        if (hashIndex === -1 || saltIndex === -1) {
            throw new Error("Configuración incompleta en la hoja de Residentes.");
        }
        
        const rowIndexInArray = residentesData.findIndex(r => _normalizeRut(r[residenteRutIndex]) === _normalizeRut(rut));
        if (rowIndexInArray === -1) {
            return { 
                success: false, 
                error: 'No se encontró el residente.' 
            };
        }

        const actualRowInSheet = rowIndexInArray + 2;
        const salt = Utilities.getUuid();
        const hash = _hashPassword(newPassword, salt);

        residentesSheet.getRange(actualRowInSheet, hashIndex + 1).setValue(hash);
        residentesSheet.getRange(actualRowInSheet, saltIndex + 1).setValue(salt);
        
        // Eliminar token usado
        const rowToDelete = data.indexOf(row) + 2; // +2 porque data ya no tiene headers y las filas empiezan en 1
        recoverySheet.deleteRow(rowToDelete);
        
        // Limpiar caché
        const cacheKey = `sheet_${residentesSheet.getSheetId()}_${residentesSheet.getLastRow()}_${residentesSheet.getLastColumn()}`;
        CacheService.getScriptCache().remove(cacheKey);
        
        return { 
            success: true, 
            message: '¡Contraseña actualizada con éxito! Ahora puedes iniciar sesión con tu nueva contraseña.' 
        };
        
    } catch (e) {
        console.error("Error en resetPasswordWithToken:", e);
        return { 
            success: false, 
            error: 'Error al actualizar la contraseña. Por favor, inténtalo nuevamente.' 
        };
    }
}