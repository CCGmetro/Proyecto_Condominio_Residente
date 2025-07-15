var SPREADSHEET_ID = '1lbioS5LjgsjJSSn_e8LUKusa0RGKXdDesfHrUG7-zJI';
var DRIVE_FOLDER_ID = '1YinETeXv-G5XsH-1VuDtFD4Dl3YTcxqB';

var SHEETS = {
  RESIDENTES: { name: 'Residentes' },
  VISITAS: { name: 'Visitas' },
  ESTACIONAMIENTOS: { name: 'Estacionamientos' },
  ENCOMIENDAS: { name: 'Encomiendas' },
  LAVANDERIA: { name: 'Lavanderia' },
  ASCENSORES: { name: 'Ascensores' },
  ANUNCIOS: { name: 'Anuncios' },
  SALAMULTIUSO: { name: 'SalaMultiuso' },
  MENSAJES: { name: 'Mensajes' },
  CONFIGURACION: { name: 'Configuracion' }
};

// --- SERVIDOR WEB ---
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Portal Residente')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- FUNCIÓN DE CARGA INICIAL (ACTUALIZADA) ---
function getInitialAppData(rut) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido para cargar datos.' };

    const residentResponse = getResidentData(rut);
    if (!residentResponse.success) return residentResponse;
    
    const resident = residentResponse.data;
    const tower = resident.tower;
    const department = resident.department;

    // Llamadas a todas las funciones de datos
    const services = getPublicServicesStatus();
    const visits = getResidentVisits(tower, department);
    const packages = getResidentPackages(rut);
    const announcements = getAnnouncements(tower, department);
    const messages = getMessages(rut);
    const parking = getParkingAvailability();
    const laundry = getLaundryServices(); // <-- NUEVA LLAMADA

    return {
      success: true,
      data: {
        profile: resident,
        services: services.data,
        visits: visits.data,
        packages: packages.data,
        announcements: announcements.data,
        messages: messages.data,
        parking: parking.data, // <-- NUEVO DATO
        laundry: laundry.data  // <-- NUEVO DATO
      }
    };
  } catch (e) {
    Logger.log('Error en getInitialAppData: ' + e.toString());
    return { success: false, message: 'Error al cargar datos de la aplicación: ' + e.message };
  }
}

// --- LÓGICA DE DATOS ---
function sheetDataToObjects(sheetData) {
  if (!sheetData || sheetData.length < 2) return [];
  const headers = sheetData[0].map(h => h ? h.trim() : '');
  return sheetData.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      if (header) obj[header] = row[i] || '';
    });
    return obj;
  });
}

function getParkingAvailability() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const parkingSheet = ss.getSheetByName(SHEETS.ESTACIONAMIENTOS.name);
    const configSheet = ss.getSheetByName(SHEETS.CONFIGURACION.name);

    if (!parkingSheet || !configSheet) {
      Logger.log("Error: Hoja 'Estacionamientos' o 'Configuracion' no encontrada.");
      return { success: false, data: { available: 0, total: 0 } };
    }

    const configData = sheetDataToObjects(configSheet.getDataRange().getDisplayValues());
    const capacitySetting = configData.find(row => row.Clave === 'CapacidadEstacionamiento');
    const totalCapacity = capacitySetting ? parseInt(capacitySetting.Valor, 10) || 0 : 0;
    
    const parkingData = sheetDataToObjects(parkingSheet.getDataRange().getDisplayValues());
    const occupiedCount = parkingData.filter(p => p.Ocupado && String(p.Ocupado).toUpperCase() === 'SI').length;
    
    const availableCount = Math.max(0, totalCapacity - occupiedCount);

    return { success: true, data: { available: availableCount, total: totalCapacity } };
  } catch (error) {
    Logger.log('Error en getParkingAvailability: ' + error.stack);
    return { success: false, data: { available: 0, total: 0 } };
  }
}

// *** NUEVA FUNCIÓN PARA LAVANDERÍA ***
function getLaundryServices() {
  Logger.log("--- INICIANDO getLaundryServices (Versión de Depuración) ---");
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const laundrySheetName = SHEETS.LAVANDERIA.name;
    const configSheetName = SHEETS.CONFIGURACION.name;

    Logger.log(`Buscando hoja de lavandería con nombre: '${laundrySheetName}'`);
    Logger.log(`Buscando hoja de configuración con nombre: '${configSheetName}'`);
    
    const laundrySheet = ss.getSheetByName(laundrySheetName);
    const configSheet = ss.getSheetByName(configSheetName);

    if (!laundrySheet) {
      Logger.log("ERROR CRÍTICO: Hoja de Lavandería no encontrada.");
      return { success: false, data: [] };
    }
    if (!configSheet) {
      Logger.log("ERROR CRÍTICO: Hoja de Configuración no encontrada.");
      return { success: false, data: [] };
    }
    Logger.log("Confirmado: Ambas hojas ('Lavanderia' y 'Configuracion') fueron encontradas.");

    // Leer totales desde Configuración
    const configData = sheetDataToObjects(configSheet.getDataRange().getDisplayValues());
    Logger.log("Datos leídos de la hoja de Configuración: " + JSON.stringify(configData));

    const washersTotalRow = configData.find(row => row.Clave === 'Lavadoras_Disponibles');
    const dryersTotalRow = configData.find(row => row.Clave === 'Secadoras_Disponibles');
    Logger.log("Fila encontrada para 'Lavadoras_Disponibles': " + JSON.stringify(washersTotalRow));
    Logger.log("Fila encontrada para 'Secadoras_Disponibles': " + JSON.stringify(dryersTotalRow));

    const washersTotal = washersTotalRow ? parseInt(washersTotalRow.Valor, 10) || 0 : 0;
    const dryersTotal = dryersTotalRow ? parseInt(dryersTotalRow.Valor, 10) || 0 : 0;
    Logger.log(`Totales calculados desde Configuración: Lavadoras=${washersTotal}, Secadoras=${dryersTotal}`);

    // Contar equipos en uso
    const laundryData = sheetDataToObjects(laundrySheet.getDataRange().getDisplayValues());
    if (laundryData.length > 0) {
      Logger.log("Encabezados detectados en la hoja de Lavandería: " + JSON.stringify(Object.keys(laundryData[0])));
    }
    let washersInUse = 0;
    let dryersInUse = 0;

    laundryData.forEach(row => {
      const equipo = row.Equipo || '';
      const horaInicio = row['Hora Inicio'] || '';
      const horaTermino = row['Hora Termino'] || '';

      if (horaInicio && !horaTermino) { // Lógica clave: en uso si tiene inicio pero no fin.
        if (equipo.toLowerCase().includes('lavadora')) {
          washersInUse++;
        } else if (equipo.toLowerCase().includes('secadora')) {
          dryersInUse++;
        }
      }
    });
    Logger.log(`Equipos en uso contados: Lavadoras en uso=${washersInUse}, Secadoras en uso=${dryersInUse}`);

    // Calcular disponibilidad
    const washersAvailable = Math.max(0, washersTotal - washersInUse);
    const dryersAvailable = Math.max(0, dryersTotal - dryersInUse);
    Logger.log(`Disponibilidad final calculada: Lavadoras=${washersAvailable}, Secadoras=${dryersAvailable}`);

    const result = [
      { equipment: 'Lavadora', available: washersAvailable, total: washersTotal },
      { equipment: 'Secadora', available: dryersAvailable, total: dryersTotal }
    ];
    
    Logger.log("Resultado final a enviar al cliente: " + JSON.stringify(result));
    return { success: true, data: result };
  } catch (error) {
    Logger.log("--- ERROR CRÍTICO DENTRO DE getLaundryServices ---");
    Logger.log(error.stack);
    return { success: false, data: [] };
  }
}

function getPublicServicesStatus() {
  // Esta función ahora solo se encarga de los ascensores
  try {
    const elevatorsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ASCENSORES.name);
    const elevators = sheetDataToObjects(elevatorsSheet.getDataRange().getDisplayValues());
    return { success: true, data: { elevators: elevators } };
  } catch (error) {
    return { success: false, data: { elevators: [] }, message: 'Error interno: ' + error.message };
  }
}

// --- RESTO DE LAS FUNCIONES (SIN CAMBIOS) ---

function login(rut, password) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido.' };
    
    // Para simplificar, asumimos una lógica de contraseña basada en los primeros 6 dígitos del RUT
    // en un escenario real, esto debería ser más seguro.
    const expectedPassword = formattedRut.replace(/\D/g, '').slice(0, 6);

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    const residents = sheetDataToObjects(sheet.getDataRange().getDisplayValues());
    const resident = residents.find(r => r.Rut === formattedRut);

    if (resident) {
      // Usamos la contraseña guardada si existe, si no, la de por defecto.
      const storedPassword = resident.Password || expectedPassword;
      if (password === storedPassword) {
         Logger.log('Login exitoso para RUT: ' + formattedRut);
         return { success: true, rut: formattedRut };
      }
    }
    
    Logger.log('Credenciales incorrectas para RUT: ' + formattedRut);
    return { success: false, message: 'RUT o contraseña incorrectos.' };
  } catch (e) {
    Logger.log('Error en login: ' + e.stack);
    return { success: false, message: 'Error al procesar el login: ' + e.message };
  }
}

function setNewPassword(rut, newPassword, confirmPassword) {
  Logger.log('Estableciendo nueva contraseña para RUT: ' + rut);
  try {
    if (!rut || !newPassword || !confirmPassword) return { success: false, message: 'Todos los campos son requeridos' };
    if (newPassword !== confirmPassword) return { success: false, message: 'Las contraseñas no coinciden' };
    if (newPassword.length < 6) return { success: false, message: 'Mínimo 6 caracteres' };

    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido' };

    const residentSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    if (!residentSheet) return { success: false, message: 'Hoja Residentes no encontrada' };

    const [headers, ...rows] = residentSheet.getDataRange().getValues();
    const rutIndex = headers.indexOf('Rut');
    const passwordIndex = headers.indexOf('Password');

    if (rutIndex === -1 || passwordIndex === -1) return { success: false, message: "Faltan 'Rut' o 'Password'" };

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][rutIndex] === formattedRut) {
        residentSheet.getRange(i + 2, passwordIndex + 1).setValue(newPassword);
        return { success: true, rut: formattedRut };
      }
    }
    return { success: false, message: 'RUT no encontrado' };
  } catch (error) {
    Logger.log('Error en setNewPassword: ' + error.stack);
    return { success: false, message: 'Error interno: ' + error.message };
  }
}

function updateResidentContactInfo(contactInfo) {
  try {
    const { fono, correo, rut } = contactInfo;
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT no válido' };

    const residentSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    if (!residentSheet) return { success: false, message: 'Hoja Residentes no encontrada' };

    const [headers, ...rows] = residentSheet.getDataRange().getValues();
    const rutIndex = headers.indexOf('Rut');
    const fonoIndex = headers.indexOf('Fono');
    const correoIndex = headers.indexOf('Correo');

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][rutIndex] === formattedRut) {
        if (fono) residentSheet.getRange(i + 2, fonoIndex + 1).setValue(fono);
        if (correo) residentSheet.getRange(i + 2, correoIndex + 1).setValue(correo);
        return { success: true, message: 'Datos actualizados' };
      }
    }
    return { success: false, message: 'Usuario no encontrado' };
  } catch (e) {
    Logger.log('Error en updateResidentContactInfo: ' + e.stack);
    return { success: false, message: 'Error interno: ' + e.message };
  }
}

function uploadResidentePhoto(fileInfo, rut) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT no válido' };

    const blob = Utilities.newBlob(Utilities.base64Decode(fileInfo.base64.split(',')[1]), fileInfo.mimeType, fileInfo.fileName);
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://drive.google.com/thumbnail?id=' + file.getId();

    const residentSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    const [headers, ...rows] = residentSheet.getDataRange().getValues();
    const rutIndex = headers.indexOf('Rut');
    const fotoIndex = headers.indexOf('Foto');

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][rutIndex] === formattedRut) {
        residentSheet.getRange(i + 2, fotoIndex + 1).setValue(url);
        return { success: true, newUrl: url + '&t=' + new Date().getTime() };
      }
    }
    return { success: false, message: 'Usuario no encontrado' };
  } catch (e) {
    Logger.log('Error en uploadResidentePhoto: ' + e.stack);
    return { success: false, message: 'Error interno: ' + e.message };
  }
}

function getResidentData(rut) {
  try {
    const formattedRut = validarRut(rut);
    if (!formattedRut) return { success: false, message: 'RUT inválido' };

    const residentSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.RESIDENTES.name);
    const residents = sheetDataToObjects(residentSheet.getDataRange().getDisplayValues());
    const resident = residents.find(r => r.Rut === formattedRut);

    if (resident) {
      const userData = {
        rut: resident.Rut || '',
        name: resident.Nombre || '',
        lastName: resident.Apellidos || '',
        tower: resident.Torre || '',
        department: resident.Departamento || '',
        phone: resident.Fono || '',
        email: resident.Correo || '',
        photo: resident.Foto || ''
      };
      return { success: true, data: userData };
    }
    return { success: false, message: 'Residente no encontrado' };
  } catch (error) {
    Logger.log('Error en getResidentData: ' + error.stack);
    return { success: false, message: 'Error interno: ' + error.message };
  }
}

function getResidentVisits(tower, department) {
  try {
    const visitsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.VISITAS.name);
    const visits = sheetDataToObjects(visitsSheet.getDataRange().getDisplayValues());
    return { success: true, data: visits.filter(v => v.Torre === tower && v.Departamento === department).sort((a, b) => b.ID - a.ID) };
  } catch (error) {
    return { success: false, data: [], message: 'Error interno: ' + error.message };
  }
}

function getResidentPackages(rut) {
  try {
    const packagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ENCOMIENDAS.name);
    const packages = sheetDataToObjects(packagesSheet.getDataRange().getDisplayValues());
    return { success: true, data: packages.filter(p => p['RUT Residente'] === rut).sort((a, b) => b.ID - a.ID) };
  } catch (error) {
    return { success: false, data: [], message: 'Error interno: ' + error.message };
  }
}

function getAnnouncements(tower, department) {
  try {
    const announcementsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ANUNCIOS.name);
    const announcements = sheetDataToObjects(announcementsSheet.getDataRange().getDisplayValues());
    const destination = `${tower}-${department}`;
    return { success: true, data: announcements.filter(a => a.Destinatario === 'Todos' || a.Destinatario === destination).sort((a, b) => b.ID - a.ID) };
  } catch (error) {
    return { success: false, data: [], message: 'Error interno: ' + error.message };
  }
}

function getMessages(rut) {
  try {
    const messagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MENSAJES.name);
    const messages = sheetDataToObjects(messagesSheet.getDataRange().getDisplayValues());
    return { success: true, data: messages.filter(m => m.Destinatario === 'Todos' || m.Destinatario === rut).sort((a, b) => b.ID - a.ID) };
  } catch (e) {
    return { success: false, data: [], message: 'Error interno: ' + e.message };
  }
}

function markMessageAsRead(messageId) {
  try {
    const messagesSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MENSAJES.name);
    const [headers, ...rows] = messagesSheet.getDataRange().getValues();
    const idIndex = headers.indexOf('ID');
    const seenIndex = headers.indexOf('Visto');

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][idIndex] === messageId) {
        messagesSheet.getRange(i + 2, seenIndex + 1).setValue('SÍ');
        return { success: true, message: 'Mensaje marcado como leído' };
      }
    }
    return { success: false, message: 'Mensaje no encontrado' };
  } catch (e) {
    Logger.log('Error en markMessageAsRead: ' + e.stack);
    return { success: false, message: 'Error interno: ' + e.message };
  }
}

function validarRut(rut) {
  if (!rut) return null;
  rut = rut.replace(/\s/g, '').replace(/\./g, '').replace(/-/g, '');
  if (!/^\d{7,8}[0-9K]$/i.test(rut)) return null;
  const body = rut.slice(0, -1);
  const dv = rut.slice(-1).toUpperCase();
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  const computedDv = mod === 11 ? '0' : mod === 10 ? 'K' : mod.toString();
  return computedDv === dv ? body.replace(/(\d{1,3})(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv : null;
}