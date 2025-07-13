var SPREADSHEET_ID = '1lbioS5LjgsjJSSn_e8LUKusa0RGKXdDesfHrUG7-zJI';
var DRIVE_FOLDER_ID = '1YinETeXv-G5XsH-1VuDtFD4Dl3YTcxqB';

var SHEETS = {
  RESIDENTES: { gid: 0 },
  VISITAS: { gid: 1409883976 },
  DEPARTAMENTOS: { gid: 1067842708 },
  ESTACIONAMIENTOS: { gid: 227107705 },
  ENCOMIENDAS: { gid: 1197993248 },
  LAVANDERIA: { gid: 260781604 },
  ASCENSORES: { gid: 605301846 },
  MENSAJES: { gid: 837880582 }
};

function doGet(e) {
  try {
    Logger.log('Iniciando doGet...');
    var template = HtmlService.createTemplateFromFile('Index');
    Logger.log('Plantilla Index cargada');
    return template.evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, user-scalable=no')
      .setTitle('Portal Residente')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (e) {
    Logger.log('Error en doGet: ' + e.message + ', Stack: ' + e.stack);
    return HtmlService.createHtmlOutput('<p>Error al cargar la aplicación: ' + e.message + '</p>');
  }
}

function include(filename) {
  try {
    Logger.log('Incluyendo archivo: ' + filename);
    var content = HtmlService.createHtmlOutputFromFile(filename).getContent();
    Logger.log('Archivo ' + filename + ' incluido con éxito');
    return content;
  } catch (e) {
    Logger.log('Error al incluir ' + filename + ': ' + e.message + ', Stack: ' + e.stack);
    return '<!-- Error al incluir ' + filename + ': ' + e.message + ' -->';
  }
}

function getSheetByGid(gid) {
  try {
    Logger.log('Buscando hoja con GID: ' + gid);
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheets = spreadsheet.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() == gid) {
        Logger.log('Hoja encontrada: ' + sheets[i].getName());
        return sheets[i];
      }
    }
    throw new Error('Hoja con GID ' + gid + ' no encontrada.');
  } catch (e) {
    Logger.log('Error en getSheetByGid: ' + e.message + ', Stack: ' + e.stack);
    throw e;
  }
}

function sheetToObjects(gid) {
  try {
    Logger.log('Convirtiendo hoja a objetos, GID: ' + gid);
    var cache = CacheService.getScriptCache();
    var cacheKey = 'sheet_' + gid;
    var cachedData = cache.get(cacheKey);
    if (cachedData) {
      Logger.log('Datos obtenidos de caché para GID: ' + gid);
      return JSON.parse(cachedData);
    }

    var sheet = getSheetByGid(gid);
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    if (data.length < 1) {
      Logger.log('No hay datos en la hoja para GID: ' + gid);
      return [];
    }
    var headers = data.shift();
    if (!headers || headers.length === 0) {
      Logger.log('No hay encabezados en la hoja para GID: ' + gid);
      return [];
    }
    var objects = data.map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        if (header) obj[header] = row[i] || '';
      });
      return obj;
    });
    cache.put(cacheKey, JSON.stringify(objects), 300);
    Logger.log('Datos cacheados para GID: ' + gid);
    return objects;
  } catch (e) {
    Logger.log('Error en sheetToObjects: ' + e.message + ', Stack: ' + e.stack);
    throw e;
  }
}

function login(rut, password) {
  try {
    Logger.log('Iniciando login para RUT: ' + rut);
    if (!rut || !password) return { success: false, message: "Debe ingresar RUT y contraseña." };
    var residentes = sheetToObjects(SHEETS.RESIDENTES.gid);
    var residente = residentes.find(function(r) { return r.Rut === rut; });
    if (!residente) {
      Logger.log('RUT no encontrado: ' + rut);
      return { success: false, message: 'RUT o contraseña incorrectos.' };
    }
    var passwordGuardada = residente.Password || "";
    if (passwordGuardada.trim() !== "") {
      if (password === passwordGuardada) {
        PropertiesService.getUserProperties().setProperty('LOGGED_IN_RUT', residente.Rut);
        Logger.log('Login exitoso para RUT: ' + rut);
        return { success: true, firstLogin: false, data: residente };
      } else {
        Logger.log('Contraseña incorrecta para RUT: ' + rut);
        return { success: false, message: 'RUT o contraseña incorrectos.' };
      }
    } else {
      var rutSinFormato = rut.replace(/\./g, '').replace(/-/g, '');
      var passwordPorDefecto = rutSinFormato.substring(0, 6);
      if (password === passwordPorDefecto) {
        PropertiesService.getUserProperties().setProperty('tempUser', residente.Rut);
        Logger.log('Primer login exitoso para RUT: ' + rut);
        return { success: true, firstLogin: true };
      } else {
        Logger.log('Contraseña inicial incorrecta para RUT: ' + rut);
        return { success: false, message: 'La contraseña inicial es incorrecta.' };
      }
    }
  } catch (e) {
    Logger.log('Error en login: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error en el servidor: ' + e.message };
  }
}

function setNewPassword(newPassword, confirmPassword) {
  try {
    Logger.log('Estableciendo nueva contraseña');
    var properties = PropertiesService.getUserProperties();
    var rut = properties.getProperty('tempUser');
    if (!rut) {
      Logger.log('Sesión expirada, no hay tempUser');
      return { success: false, message: "La sesión ha expirado. Vuelva a iniciar sesión." };
    }
    if (!newPassword || newPassword.length < 6) {
      Logger.log('Contraseña inválida: longitud < 6');
      return { success: false, message: "La contraseña debe tener al menos 6 caracteres."};
    }
    if (newPassword !== confirmPassword) {
      Logger.log('Contraseñas no coinciden');
      return { success: false, message: "Las contraseñas no coinciden."};
    }
    var sheet = getSheetByGid(SHEETS.RESIDENTES.gid);
    var allData = sheet.getDataRange().getValues();
    var headers = allData.shift();
    var rutIndex = headers.indexOf("Rut");
    var passwordIndex = headers.indexOf("Password");
    if (rutIndex === -1 || passwordIndex === -1) {
      Logger.log('Faltan columnas Rut o Password');
      throw new Error("Faltan columnas 'Rut' o 'Password'.");
    }
    for (var i = 0; i < allData.length; i++) {
      if (allData[i][rutIndex] === rut) {
        sheet.getRange(i + 2, passwordIndex + 1).setValue(newPassword);
        CacheService.getScriptCache().remove('sheet_' + SHEETS.RESIDENTES.gid);
        properties.deleteProperty('tempUser');
        properties.setProperty('LOGGED_IN_RUT', rut);
        var residenteData = sheetToObjects(SHEETS.RESIDENTES.gid).find(function(r) { return r.Rut === rut; });
        Logger.log('Contraseña actualizada para RUT: ' + rut);
        return { success: true, message: "Contraseña creada.", data: residenteData };
      }
    }
    Logger.log('Registro no encontrado para RUT: ' + rut);
    return { success: false, message: "No se encontró su registro." };
  } catch (e) {
    Logger.log('Error en setNewPassword: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error al guardar contraseña: ' + e.message };
  }
}

function checkLogin() {
  try {
    Logger.log('Verificando estado de login');
    var rut = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    Logger.log('Estado de login: ' + (rut ? 'Logueado con RUT ' + rut : 'No logueado'));
    return { isLoggedIn: !!rut };
  } catch (e) {
    Logger.log('Error en checkLogin: ' + e.message + ', Stack: ' + e.stack);
    return { isLoggedIn: false, message: e.message };
  }
}

function logout() {
  try {
    Logger.log('Cerrando sesión');
    PropertiesService.getUserProperties().deleteProperty('LOGGED_IN_RUT');
    PropertiesService.getUserProperties().deleteProperty('tempUser');
    Logger.log('Sesión cerrada exitosamente');
    return { success: true };
  } catch (e) {
    Logger.log('Error en logout: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error al cerrar sesión: ' + e.message };
  }
}

function getResidentData() {
  try {
    Logger.log('Obteniendo datos del residente');
    var rut = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    if (!rut) {
      Logger.log('No autenticado, sin LOGGED_IN_RUT');
      return { success: false, error: 'No autenticado.' };
    }
    var residentes = sheetToObjects(SHEETS.RESIDENTES.gid);
    var residente = residentes.find(function(r){return r.Rut === rut});
    if (residente) {
      var datosLimpios = {};
      Object.keys(residente).forEach(function(key){ datosLimpios[key] = residente[key]; });
      delete datosLimpios.Password;
      Logger.log('Datos del residente obtenidos para RUT: ' + rut);
      return { success: true, data: datosLimpios };
    }
    Logger.log('Residente no encontrado para RUT: ' + rut);
    return { success: false, error: 'Residente no encontrado.' };
  } catch (e) {
    Logger.log('Error en getResidentData: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, error: 'Error al obtener datos del residente: ' + e.message };
  }
}

function getResidentVisits() {
  try {
    Logger.log('Obteniendo visitas del residente');
    var rut = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    if (!rut) {
      Logger.log('No autenticado, sin LOGGED_IN_RUT');
      return { success: false, error: 'No autenticado.'};
    }
    var miResidente = sheetToObjects(SHEETS.RESIDENTES.gid).find(function(r){ return r.Rut === rut});
    if (!miResidente) {
      Logger.log('Residente no encontrado para RUT: ' + rut);
      return { success: false, error: 'Residente no encontrado.'};
    }
    var todasLasVisitas = sheetToObjects(SHEETS.VISITAS.gid);
    var misVisitas = todasLasVisitas.filter(function(v) {return v.Torre == miResidente.Torre && v.Departamento == miResidente.Departamento});
    Logger.log('Visitas obtenidas: ' + misVisitas.length);
    return { success: true, data: misVisitas.sort(function(a,b) {return b.ID - a.ID}), count: misVisitas.length };
  } catch (e) {
    Logger.log('Error en getResidentVisits: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, error: 'Error al obtener visitas: ' + e.message };
  }
}

function getResidentPackages() {
  try {
    Logger.log('Obteniendo encomiendas del residente');
    var rut = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    if (!rut) {
      Logger.log('No autenticado, sin LOGGED_IN_RUT');
      return { success: false, error: 'No autenticado.'};
    }
    var miResidente = sheetToObjects(SHEETS.RESIDENTES.gid).find(function(r){ return r.Rut === rut});
    if (!miResidente) {
      Logger.log('Residente no encontrado para RUT: ' + rut);
      return { success: false, error: 'Residente no encontrado.'};
    }
    var todasLasEncomiendas = sheetToObjects(SHEETS.ENCOMIENDAS.gid);
    var misEncomiendas = todasLasEncomiendas.filter(function(e) { 
      return e['RUT Residente'] === rut || 
             (e.Torre === miResidente.Torre && e.Departamento === miResidente.Departamento) ||
             e['Nombre Residente'] === (miResidente.Nombre + ' ' + miResidente.Apellidos);
    });
    var encomiendasPendientes = misEncomiendas.filter(function(e) { return String(e.Estado).toUpperCase() === 'PENDIENTE'; });
    Logger.log('Encomiendas totales obtenidas: ' + misEncomiendas.length + ', Pendientes: ' + encomiendasPendientes.length);
    return { 
      success: true, 
      data: misEncomiendas.sort(function(a,b) {return b.ID - a.ID}), 
      count: encomiendasPendientes.length 
    };
  } catch (e) {
    Logger.log('Error en getResidentPackages: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, error: 'Error al obtener encomiendas: ' + e.message };
  }
}

function getMessages() {
  try {
    Logger.log('Obteniendo mensajes');
    var rutLogueado = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    if (!rutLogueado) {
      Logger.log('No autenticado, sin LOGGED_IN_RUT');
      return { success: false, error: "Usuario no autenticado." };
    }
    var todosResidentes = sheetToObjects(SHEETS.RESIDENTES.gid);
    var infoResidente = todosResidentes.find(function(r) { return r.Rut === rutLogueado; });
    if (!infoResidente) {
      Logger.log('Residente no encontrado para RUT: ' + rutLogueado);
      return { success: false, error: "No se pudo obtener información del residente."};
    }
    var miDepto = infoResidente.Torre + '-' + infoResidente.Departamento;
    var todosLosAnuncios = sheetToObjects(SHEETS.MENSAJES.gid);
    var anunciosRelevantes = todosLosAnuncios.filter(function(anuncio) { 
      return anuncio.Destinatario === 'Todos' || anuncio.Destinatario === miDepto;
    });
    var anunciosNoLeidos = anunciosRelevantes.filter(function(anuncio) { 
      return anuncio.Visto !== 'SÍ';
    });
    Logger.log('Mensajes totales obtenidos: ' + anunciosRelevantes.length + ', No leídos: ' + anunciosNoLeidos.length);
    return { 
      success: true, 
      data: anunciosRelevantes.sort(function(a, b) { return b.ID - a.ID; }), 
      count: anunciosNoLeidos.length 
    };
  } catch (e) {
    Logger.log('Error en getMessages: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, error: 'Error al obtener mensajes: ' + e.message };
  }
}

function markMessageAsRead(messageId) {
  try {
    Logger.log('Marcando mensaje como leído, ID: ' + messageId);
    var sheet = getSheetByGid(SHEETS.MENSAJES.gid);
    var allData = sheet.getDataRange().getValues();
    var headers = allData.shift();
    var idIndex = headers.indexOf('ID');
    var vistoIndex = headers.indexOf('Visto');
    if (idIndex === -1 || vistoIndex === -1) {
      Logger.log('Faltan columnas ID o Visto en la hoja Mensajes');
      throw new Error("Faltan columnas 'ID' o 'Visto' en la hoja Mensajes.");
    }
    for (var i = 0; i < allData.length; i++) {
      if (allData[i][idIndex] == messageId) {
        sheet.getRange(i + 2, vistoIndex + 1).setValue('SÍ');
        CacheService.getScriptCache().remove('sheet_' + SHEETS.MENSAJES.gid);
        Logger.log('Mensaje marcado como leído, ID: ' + messageId);
        return { success: true };
      }
    }
    Logger.log('Mensaje no encontrado, ID: ' + messageId);
    return { success: false, message: 'Mensaje no encontrado.' };
  } catch (e) {
    Logger.log('Error en markMessageAsRead: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error al marcar mensaje como leído: ' + e.message };
  }
}

function getPublicServicesStatus() {
  try {
    Logger.log('Obteniendo estado de servicios públicos');
    var ascensores = sheetToObjects(SHEETS.ASCENSORES.gid);
    var usosLavanderia = sheetToObjects(SHEETS.LAVANDERIA.gid);
    var lavadorasEnUso = usosLavanderia.filter(function(u) {return u.Equipo === 'Lavadora' && !u["Hora Termino"]}).length;
    var secadorasEnUso = usosLavanderia.filter(function(u) {return u.Equipo === 'Secadora' && !u["Hora Termino"]}).length;
    var estacionamientos = sheetToObjects(SHEETS.ESTACIONAMIENTOS.gid);
    var totalEstacionamientos = estacionamientos.length;
    var estacionamientosOcupados = estacionamientos.filter(function(e){ return String(e.Ocupado).toUpperCase() === 'SI'}).length;
    Logger.log('Servicios obtenidos: Ascensores=' + ascensores.length + ', Lavadoras=' + lavadorasEnUso + ', Secadoras=' + secadorasEnUso + ', Estacionamientos=' + totalEstacionamientos);
    return {
      success: true,
      data: {
        ascensores: ascensores,
        lavanderia: { lavadoras: { enUso: lavadorasEnUso }, secadoras: { enUso: secadorasEnUso } },
        estacionamientos: { total: totalEstacionamientos, ocupados: estacionamientosOcupados }
      }
    };
  } catch (e) {
    Logger.log('Error en getPublicServicesStatus: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, error: 'Error al obtener servicios: ' + e.message };
  }
}

function updateResidentContactInfo(data) {
  try {
    Logger.log('Actualizando información de contacto');
    var rut = PropertiesService.getUserProperties().getProperty('LOGGED_IN_RUT');
    if (!rut) {
      Logger.log('No autenticado, sin LOGGED_IN_RUT');
      return { success: false, message: 'No autenticado.' };
    }
    var sheet = getSheetByGid(SHEETS.RESIDENTES.gid);
    var allData = sheet.getDataRange().getValues();
    var headers = allData.shift();
    var rutIndex = headers.indexOf("Rut");
    var fonoIndex = headers.indexOf("Fono");
    var correoIndex = headers.indexOf("Correo");
    if (rutIndex === -1 || fonoIndex === -1 || correoIndex === -1) {
      Logger.log('Faltan columnas en la hoja Residentes');
      throw new Error("Faltan columnas en la hoja Residentes.");
    }
    for (var i = 0; i < allData.length; i++) {
      if (allData[i][rutIndex] === rut) {
        sheet.getRange(i + 2, fonoIndex + 1).setValue(data.fono);
        sheet.getRange(i + 2, correoIndex + 1).setValue(data.correo);
        CacheService.getScriptCache().remove('sheet_' + SHEETS.RESIDENTES.gid);
        SpreadsheetApp.flush();
        Logger.log('Datos actualizados para RUT: ' + rut);
        return { success: true, message: 'Datos actualizados.' };
      }
    }
    Logger.log('Registro no encontrado para RUT: ' + rut);
    return { success: false, message: 'No se encontró tu registro.' };
  } catch (e) {
    Logger.log('Error en updateResidentContactInfo: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error al actualizar: ' + e.message };
  }
}

function uploadResidentePhoto(fileInfo, rut) {
  try {
    Logger.log('Subiendo foto para RUT: ' + rut);
    if (!rut || !fileInfo || !fileInfo.base64) {
      Logger.log('Faltan datos para subir la foto');
      throw new Error("Faltan datos para subir la foto.");
    }
    var carpetaRaiz = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var carpetaFotos = (function() {
      var existe = carpetaRaiz.getFoldersByName("Fotos Residentes");
      return existe.hasNext() ? existe.next() : carpetaRaiz.createFolder("Fotos Residentes");
    })();
    var archivos = carpetaFotos.getFiles();
    while (archivos.hasNext()) {
      var archivo = archivos.next();
      if (archivo.getName().startsWith(rut + '.')) archivo.setTrashed(true);
    }
    var extension = fileInfo.fileName.split('.').pop() || 'jpg';
    var nombreArchivo = rut + '.' + extension;
    var blob = Utilities.newBlob(Utilities.base64Decode(fileInfo.base64.split(',')[1]), fileInfo.mimeType, nombreArchivo);
    var nuevoArchivo = carpetaFotos.createFile(blob);
    nuevoArchivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fotoUrl = 'https://drive.google.com/thumbnail?id=' + nuevoArchivo.getId() + '&sz=w300&t=' + Date.now();
    var sheet = getSheetByGid(SHEETS.RESIDENTES.gid);
    var data = sheet.getDataRange().getValues();
    var headers = data.shift();
    var rutIndex = headers.indexOf("Rut");
    var fotoIndex = headers.indexOf("Foto") + 1;
    for (var i = 0; i < data.length; i++) {
      if (data[i][rutIndex] === rut) {
        sheet.getRange(i + 2, fotoIndex).setValue(fotoUrl);
        CacheService.getScriptCache().remove('sheet_' + SHEETS.RESIDENTES.gid);
        Logger.log('Foto subida y URL actualizada: ' + fotoUrl);
        break;
      }
    }
    return { success: true, newUrl: fotoUrl };
  } catch (e) {
    Logger.log('Error en uploadResidentePhoto: ' + e.message + ', Stack: ' + e.stack);
    return { success: false, message: 'Error al subir foto: ' + e.message };
  }
}

// Code.gs
function getResidentReservations() {
  try {
    // Ejemplo: Consulta a una hoja de Google Sheets
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reservas');
    var data = sheet.getDataRange().getValues();
    var reservations = data.slice(1).map(function(row) {
      return {
        ID: row[0],
        'Espacio Común': row[1],
        'Fecha Reserva': row[2],
        'Hora Reserva': row[3],
        Estado: row[4],
        Comentarios: row[5] || ''
      };
    });
    var count = reservations.filter(function(r) {
      return ['PENDIENTE', 'CONFIRMADA'].indexOf(String(r.Estado).toUpperCase()) !== -1;
    }).length;
    return { success: true, data: reservations, count: count };
  } catch (e) {
    Logger.log('Error en getResidentReservations: ' + e);
    return { success: false, message: 'Error al obtener las reservas: ' + e.message };
  }
}

function createReservation(reservationData) {
  try {
    if (!reservationData.space || !reservationData.date || !reservationData.time) {
      return { success: false, message: 'Faltan datos obligatorios para la reserva.' };
    }
    // Ejemplo: Guardar en una hoja de Google Sheets
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reservas');
    var id = sheet.getLastRow(); // Simple ID increment
    sheet.appendRow([
      id,
      reservationData.space,
      reservationData.date,
      reservationData.time,
      'PENDIENTE',
      reservationData.comments || '',
      reservationData.residentRut
    ]);
    return { success: true, message: 'Reserva creada exitosamente.' };
  } catch (e) {
    Logger.log('Error en createReservation: ' + e);
    return { success: false, message: 'Error al crear la reserva: ' + e.message };
  }
}