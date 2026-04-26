// ================================================================
// FIREBASE CONFIGURATION — substitua os valores abaixo pelas
// credenciais reais do seu projeto Firebase.
//
// Como obter:
//   1. Acesse https://console.firebase.google.com/
//   2. Selecione (ou crie) seu projeto
//   3. Clique no ícone de engrenagem → Configurações do projeto
//   4. Role até "Seus aplicativos" → selecione ou crie um app Web
//   5. Copie os valores do objeto firebaseConfig
// ================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBx-uqRrLZU1jd8pISABPRC7Qob87uqz2o",
  authDomain: "consultorio-dra-thuani.firebaseapp.com",
  projectId: "consultorio-dra-thuani",
  storageBucket: "consultorio-dra-thuani.firebasestorage.app",
  messagingSenderId: "390572380657",
  appId: "1:390572380657:web:0517aa86ec14cd2a01f450"
};

// ================================================================
// PAPÉIS DOS USUÁRIOS
// Mapeie cada e-mail ao papel correspondente.
//   'medica'     → acesso total (todas as telas + exclusão)
//   'secretaria' → acesso operacional (sem DRE, sem exclusão)
//
// Substitua os e-mails pelos endereços reais das usuárias.
// ================================================================
export const userRoles = {
  "thuanicampanha@gmail.com":      "medica",
  "secretariadrathuanicampanha@gmail.com":  "secretaria"
};

// ================================================================
// RÓTULOS AMIGÁVEIS
// ================================================================
export const labels = {
  consultationType: {
    primeira:    "Primeira Consulta",
    retorno:     "Retorno",
    teleconsulta:"Teleconsulta",
    atestado:    "Atestado"
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
  }
};
