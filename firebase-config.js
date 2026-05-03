// ================================================================
// FIREBASE CONFIGURATION
// ================================================================
export const firebaseConfig = {
  apiKey:            "AIzaSyBx-uqRrLZU1jd8pISABPRC7Qob87uqz2o",
  authDomain:        "consultorio-dra-thuani.firebaseapp.com",
  projectId:         "consultorio-dra-thuani",
  storageBucket:     "consultorio-dra-thuani.firebasestorage.app",
  messagingSenderId: "390572380657",
  appId:             "1:390572380657:web:0517aa86ec14cd2a01f450"
};

// ================================================================
// PAPÉIS DOS USUÁRIOS
// ================================================================
export const userRoles = {
  "thuanicampanha@gmail.com":               "medica",
  "secretariadrathuanicampanha@gmail.com":  "secretaria"
};

// ================================================================
// RÓTULOS AMIGÁVEIS
// ================================================================
export const labels = {
  consultationType: {
    presencial:   "Presencial",
    teleconsulta: "Teleconsulta"
  },
  status: {
    pix:      "Recebido PIX",
    pendente: "Pendente",
    gratuito: "Gratuito"
  },
  invoiceStatus: {
    pendente: "Pendente",
    emitida:  "Emitida",
    isenta:   "Isenta"
  },
  expenseCategory: {
    aluguel:   "Aluguel",
    iclinic:   "iClinic",
    secretaria:"Secretária",
    contador:  "Contador",
    material:  "Material",
    consumo:   "Contas de consumo",
    impostos:  "Impostos",
    outros:    "Outros"
  },
  recurrence: {
    unica:  "Única",
    mensal: "Mensal"
  },
  role: {
    medica:     "Médica",
    secretaria: "Secretária"
  },
  patientStatus: {
    ativo:  "Ativo",
    inativo:"Inativo",
    alta:   "Alta"
  },
  gender: {
    m: "Masculino",
    f: "Feminino",
    o: "Outro"
  }
};
