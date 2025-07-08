// ==========================================
//    TEST C - CÓDIGO COMPLETO Y CORREGIDO
// ==========================================

const SPREADSHEET_ID = '1lbioS5LjgsjJSSn_e8LUKusa0RGKXdDesfHrUG7-zJI';
const SHEETS = {
  RESIDENTES: { gid: 0 },
  VISITAS: { gid: 1409883976 },
  DEPARTAMENTOS: { gid: 1067842708 },
  CONFIGURACION: { gid: 34039155 },
  ESTACIONAMIENTOS: { gid: 227107705 },
  ENCOMIENDAS: { gid: 1197993248 },
  LAVANDERIA: { gid: 260781604 },
  ASCENSORES: { gid: 605301846 },
  MENSAJES: { gid: 1234567890 } // Asegúrate que este GID es correcto
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index');
}

// --- FUNCIÓN ESPECIAL SOLO PARA EL TEST C ---
function testFullDataLoad() {
  Logger.log("Iniciando TEST C: Carga completa de datos");
  try {
    const todosResidentes = sheetToObjects(SHEETS.RESIDENTES.gid);
    if (todosResidentes.length === 0) {
      throw new Error("La hoja de Residentes está vacía o no se pudo leer.");
    }
    const residenteDePrueba = todosResidentes[0];
    Logger.log("Usando residente de prueba: " + residenteDePrueba.Nombre);

    const [servicios, encomiendas, visitas, mensajes, config] = [
        _getServiciosStatus(),
        _getMisEncomiendas(residenteDePrueba.Torre, residenteDePrueba.Departamento),
        _getMiHistorialVisitas(residenteDePrueba.Torre, residenteDePrueba.Departamento),
        _getMisMensajes(residenteDePrueba),
        _getConfig()
    ];
    Logger.log("Todos los datos para el residente de prueba fueron recopilados.");
    
    return { success: true, data: { perfil: residenteDePrueba, servicios, encomiendas, visitas, mensajes, config }};
  } catch (e) {
    Logger.log("FALLA en testFullDataLoad: " + e.message);
    return { success: false, error: e.message };
  }
}

// --- FUNCIONES DE SOPORTE (LAS QUE FALTABAN) ---
function getSheetByGid(gid) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    for (let s of sheets) {
      if (s.getSheetId() == gid) return s;
    }
    return null;
  } catch (e) {
    console.error(`Error abriendo la hoja de cálculo: ${e.message}`);
    return null;
  }
}

function sheetToObjects(gid) {
  try {
    const sheet = getSheetByGid(gid);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data.shift().map(h => h ? h.trim() : '');
    return data.map((row, index) => {
      const obj = { _rowIndex: index + 2 };
      headers.forEach((header, i) => { if (header) obj[header] = row[i]; });
      return obj;
    });
  } catch (e) {
    console.error(`Error en sheetToObjects para GID ${gid}: ${e.message}`);
    return [];
  }
}

function _normalizeRut(rut) {
    if (!rut) return '';
    return rut.toString().toUpperCase().replace(/[.-]/g, '');
}

// --- FUNCIONES AUXILIARES DE RECOPILACIÓN DE DATOS ---
function _getConfig() {
  try {
    const configData = sheetToObjects(SHEETS.CONFIGURACION.gid);
    const config = {};
    configData.forEach(row => { if (row.Clave) config[row.Clave] = row.Valor; });
    return config;
  } catch (e) {
    console.error("Error en _getConfig:", e.message);
    return { NombreCondominio: "Mi Condominio" };
  }
}
function _getServiciosStatus() {
  try {
    const ascensores = sheetToObjects(SHEETS.ASCENSORES.gid);
    const usosLavanderia = sheetToObjects(SHEETS.LAVANDERIA.gid).filter(u => !u["Hora Termino"]);
    const estacionamientos = sheetToObjects(SHEETS.ESTACIONAMIENTOS.gid);
    const estacionamientosOcupados = estacionamientos.filter(e => String(e.Ocupado).toUpperCase() === 'SI').length;
    return { ascensores, lavadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Lavadora').length, secadorasEnUso: usosLavanderia.filter(u => u.Equipo === 'Secadora').length, estacionamientos: { total: estacionamientos.length, ocupados: estacionamientosOcupados }};
  } catch(e) {
    console.error("Error en _getServiciosStatus:", e.message);
    return { ascensores: [], lavadorasEnUso: 0, secadorasEnUso: 0, estacionamientos: {total: 0, ocupados: 0} };
  }
}
function _getMisEncomiendas(torre, depto) {
  try {
    const todasEncomiendas = sheetToObjects(SHEETS.ENCOMIENDAS.gid);
    return todasEncomiendas.filter(e => e.Torre == torre && e.Departamento == depto && String(e.Estado).toUpperCase() === 'PENDIENTE');
  } catch(e) {
    console.error("Error en _getMisEncomiendas:", e.message);
    return [];
  }
}
function _getMiHistorialVisitas(torre, depto) {
  try {
    const todasVisitas = sheetToObjects(SHEETS.VISITAS.gid);
    return todasVisitas.filter(v => v.Torre == torre && v.Departamento == depto).sort((a,b) => b.ID - a.ID).slice(0, 20); 
  } catch(e) {
    console.error("Error en _getMiHistorialVisitas:", e.message);
    return [];
  }
}
function _getMisMensajes(residente) {
  try {
    const todosMensajes = sheetToObjects(SHEETS.MENSAJES.gid);
    return todosMensajes.filter(m => {
      if (!m.Destinatario) return false;
      const dest = m.Destinatario.toUpperCase();
      return dest === 'TODOS' || dest === `T${residente.Torre}` || dest === `T${residente.Torre}-${residente.Departamento}` || dest === _normalizeRut(residente.Rut);
    }).sort((a,b) => b.ID - a.ID);
  } catch (e) {
    console.error("Error en _getMisMensajes:", e.message);
    return [];
  }
}