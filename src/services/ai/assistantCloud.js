// src/services/ai/assistantCloud.js
// Puente seguro entre el POS y el asistente IA.
// La clave de Gemini vive exclusivamente en Cloud Functions.

import {
  httpsCallable,
} from "firebase/functions";

import {
  functions,
} from "../../firebase/config";

const fnConsultarAsistenteIa =
  httpsCallable(
    functions,
    "consultarAsistenteIa",
    {
      timeout: 30000,
    }
  );

export async function consultarAsistenteIa({
  pregunta,
  historial = [],
  contexto,
  operadorSesion,
  deviceId,
}) {
  const response =
    await fnConsultarAsistenteIa({
      pregunta,
      historial,
      contexto,
      operadorSesion,
      deviceId,
    });

  return response?.data || {};
}
