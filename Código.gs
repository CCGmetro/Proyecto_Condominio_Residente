var SPREADSHEET_ID = '1lbioS5LjgsjJSSn_e8LUKusa0RGKXdDesfHrUG7-zJI';
var DRIVE_FOLDER_ID = '1YinETeXv-G5XsH-1VuDtFD4Dl3YTcxqB';

var SHEETS = {
  RESIDENTES: { name: 'Residentes' },
  VISITAS: { name: 'Visitas' },
  ESTACIONAMIENTO: { name: 'Estacionamientos' },
  ENCOMIENDAS: { name: 'Encomiendas' },
  LAVANDERIA: { name: 'Lavanderia' },
  ASCENSORES: { name: 'Ascensores' },
  MENSAJES: { name: 'Mensajes' },
  CONFIGURACION: { name: 'Configuracion' }
};

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Portal Residente').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getInitialAppData(rut) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido para cargar datos.' };
    const residentResponse = getResidentData(rut);
    if (!residentResponse.success) return residentResponse;
    const [resident, services, parking, laundry, visits, packages, messages] = [
      residentResponse.data, getPublicServicesStatus(), getParkingAvailability(), getLaundryServices(),
      getResidentVisits(residentResponse.data.tower, residentResponse.data.department),
      getResidentPackages(formattedRut), getMessages(formattedRut)
    ];
    return { success: true, data: { profile: resident, services: services.data, parking: parking.data, laundry: laundry.data, visits: visits.data, packages: packages.data, messages: messages.data } };
  } catch (e) {
    Logger.log('Error en getInitialAppData: ' + e.stack);
    return { success: false, message: 'Error crítico al cargar datos: ' + e.message };
  }
}

function sheetDataToObjects(sheetData) {
  if (!sheetData || sheetData.length < 2) return [];
  const headers = sheetData[0].map(h => h ? h.trim() : '');
  return sheetData.slice(1).map(row => { const obj = {}; headers.forEach((header, i) => { if (header) obj[header] = row[i] || ''; }); return obj; });
}

function getParkingAvailability() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const parkingSheet = ss.getSheetByName(SHEETS.ESTACIONAMIENTO.name);
    const configSheet = ss.getSheetByName(SHEETS.CONFIGURACION.name);
    if (!parkingSheet || !configSheet) return { success: false, data: { available: 0, total: 0 } };
    const configData = sheetDataToObjects(configSheet.getDataRange().getDisplayValues());
    const capacitySetting = configData.find(row => row.Clave === 'CapacidadEstacionamiento');
    const totalCapacity = capacitySetting ? parseInt(capacitySetting.Valor, 10) || 0 : 0;
    const parkingData = sheetDataToObjects(parkingSheet.getDataRange().getDisplayValues());
    const occupiedCount = parkingData.filter(p => p.Ocupado && String(p.Ocupado).toUpperCase() === 'SI').length;
    const availableCount = Math.max(0, totalCapacity - occupiedCount);
    return { success: true, data: { available: availableCount, total: totalCapacity } };
  } catch (error) { return { success: false, data: { available: 0, total: 0 } }; }
}

function getLaundryServices() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const laundrySheet = ss.getSheetByName(SHEETS.LAVANDERIA.name);
    const configSheet = ss.getSheetByName(SHEETS.CONFIGURACION.name);
    if (!laundrySheet || !configSheet) return { success: false, data: [] };
    const configData = sheetDataToObjects(configSheet.getDataRange().getDisplayValues());
    const washersTotalRow = configData.find(row => row.Clave === 'Lavadoras_Disponibles');
    const dryersTotalRow = configData.find(row => row.Clave === 'Secadoras_Disponibles');
    const washersTotal = washersTotalRow ? parseInt(washersTotalRow.Valor, 10) || 0 : 0;
    const dryersTotal = dryersTotalRow ? parseInt(dryersTotalRow.Valor, 10) || 0 : 0;
    const laundryData = sheetDataToObjects(laundrySheet.getDataRange().getDisplayValues());
    const washersInUse = laundryData.filter(u => u.Equipo === 'Lavadora' && !u['Hora Termino']).length;
    const dryersInUse = laundryData.filter(u => u.Equipo === 'Secadora' && !u['Hora Termino']).length;
    const washersAvailable = Math.max(0, washersTotal - washersInUse);
    const dryersAvailable = Math.max(0, dryersTotal - dryersInUse);
    return { success: true, data: [{ equipment: 'Lavadora', available: washersAvailable, total: washersTotal }, { equipment: 'Secadora', available: dryersAvailable, total: dryersTotal }]};
  } catch (error) { return { success: false, data: [] }; }
}

function getPublicServicesStatus() {
  try {
    const elevatorsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ASCENSORES.name);
    const elevators = elevatorsSheet ? sheetDataToObjects(elevatorsSheet.getDataRange().getDisplayValues()) : [];
    return { success: true, data: { elevators: elevators } };
  } catch (error) { return { success: false, data: { elevators: [] } }; }
}

function login(rut, password) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido.' };
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    const residents = sheetDataToObjects(sheet.getDataRange().getDisplayValues());
    const resident = residents.find(r => r.Rut === formattedRut);
    if (resident) {
      const initialPassword = formattedRut.replace(/\D/g, '').slice(0, 6);
      if (!resident.Password) {
        if (password === initialPassword) {
          PropertiesService.getUserProperties().setProperty('tempRut', formattedRut);
          return { success: true, firstLogin: true, rut: formattedRut };
        }
      } else {
        if (password === resident.Password) {
          return { success: true, firstLogin: false, rut: formattedRut };
        }
      }
    }
    return { success: false, message: 'RUT o contraseña incorrectos.' };
  } catch (e) { return { success: false, message: 'Error al procesar el login.' }; }
}

function setNewPassword(newPassword, confirmPassword) {
  const tempRut = PropertiesService.getUserProperties().getProperty('tempRut');
  if (!tempRut) return { success: false, message: "Sesión expirada. Vuelva a iniciar sesión." };
  if (!newPassword || newPassword.length < 6) return { success: false, message: "La contraseña debe tener al menos 6 caracteres." };
  if (newPassword !== confirmPassword) return { success: false, message: "Las contraseñas no coinciden." };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rutIndex = headers.indexOf('Rut');
  const passwordIndex = headers.indexOf('Password');

  for (let i = 1; i < data.length; i++) {
    if (data[i][rutIndex] === tempRut) {
      sheet.getRange(i + 1, passwordIndex + 1).setValue(newPassword);
      PropertiesService.getUserProperties().deleteProperty('tempRut');
      return { success: true, rut: tempRut };
    }
  }
  return { success: false, message: "No se encontró el residente." };
}

// --- NUEVA FUNCIÓN PARA ACTUALIZAR CONTRASEÑA DE USUARIO LOGUEADO ---
function updateUserPassword(rut, currentPassword, newPassword, confirmPassword) {
  if (!rut) return { success: false, message: "No hay una sesión activa." };
  
  if (!currentPassword || !newPassword || !confirmPassword) return { success: false, message: "Todos los campos son requeridos." };
  if (newPassword.length < 6) return { success: false, message: "La nueva contraseña debe tener al menos 6 caracteres." };
  if (newPassword !== confirmPassword) return { success: false, message: "Las contraseñas nuevas no coinciden." };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rutIndex = headers.indexOf('Rut');
  const passwordIndex = headers.indexOf('Password');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][rutIndex] === rut) {
      const storedPassword = data[i][passwordIndex];
      const initialPassword = rut.replace(/\D/g, '').slice(0, 6);
      const effectivePassword = storedPassword || initialPassword;

      if (effectivePassword !== currentPassword) {
        return { success: false, message: "La contraseña actual es incorrecta." };
      }
      sheet.getRange(i + 1, passwordIndex + 1).setValue(newPassword);
      return { success: true };
    }
  }
  return { success: false, message: "No se encontró tu usuario." };
}

function getResidentData(rut) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido' };
    const residentSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    const residents = sheetDataToObjects(residentSheet.getDataRange().getDisplayValues());
    const resident = residents.find(r => r.Rut === formattedRut);
    if (resident) {
      return { success: true, data: { rut: resident.Rut, name: resident.Nombre, lastName: resident.Apellidos, tower: resident.Torre, department: resident.Departamento, phone: resident.Fono, email: resident.Correo, photo: resident.Foto }};
    }
    return { success: false, message: 'Residente no encontrado' };
  } catch (error) { return { success: false, message: 'Error interno.' }; }
}
function getResidentVisits(tower, department) {
  try {
    const visitsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.VISITAS.name);
    return { success: true, data: sheetDataToObjects(visitsSheet.getDataRange().getDisplayValues()).filter(v => v.Torre === tower && v.Departamento === department).sort((a, b) => b.ID - a.ID) };
  } catch (error) { return { success: false, data: [] }; }
}
function getResidentPackages(rut) {
  try {
    const packagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ENCOMIENDAS.name);
    return { success: true, data: sheetDataToObjects(packagesSheet.getDataRange().getDisplayValues()).filter(p => p['RUT Residente'] === rut).sort((a, b) => b.ID - a.ID) };
  } catch (error) { return { success: false, data: [] }; }
}
function getMessages(rut) {
  try {
    const messagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MENSAJES.name);
    return { success: true, data: sheetDataToObjects(messagesSheet.getDataRange().getDisplayValues()).filter(m => m.Destinatario === 'Todos' || m.Destinatario === rut).sort((a, b) => b.ID - a.ID) };
  } catch (e) { return { success: false, data: [] }; }
}
function validarRut(rut) {
  if (!rut) return null; rut = rut.replace(/\s/g, '').replace(/\./g, '').replace(/-/g, ''); if (!/^\d{7,8}[0-9K]$/i.test(rut)) return null; const body = rut.slice(0, -1); const dv = rut.slice(-1).toUpperCase(); let sum = 0; let mul = 2; for (let i = body.length - 1; i >= 0; i--) { sum += parseInt(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; } const mod = 11 - (sum % 11); const computedDv = mod === 11 ? '0' : mod === 10 ? 'K' : mod.toString(); return computedDv === dv ? body.replace(/(\d{1,3})(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv : null;
}