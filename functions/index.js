// functions/index.js
// Cloud Functions para el panel administrativo del POS
// Deploy: firebase deploy --only functions
// Escrito con la sintaxis de firebase-functions v2 (SDK actual)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

/**
 * Verifica que quien llama a la función sea un admin autorizado.
 * Lanza un error si no lo es.
 */
async function verificarAdmin(auth) {
    if (!auth) {
        throw new HttpsError("unauthenticated", "Debés iniciar sesión.");
    }
    const adminDoc = await db.collection("admins").doc(auth.uid).get();
    if (!adminDoc.exists) {
        throw new HttpsError("permission-denied", "No tenés permisos de administrador.");
    }
}

/**
 * Lista todos los clientes con su estado y fechas.
 * Llamado desde el panel admin.
 */
exports.listarClientes = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const snapshot = await db.collection("clientes").orderBy("fechaRegistro", "desc").get();
    const clientes = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    }));

    return { clientes };
});

/**
 * Crea un nuevo cliente: usuario en Firebase Auth + documento en Firestore.
 */
exports.crearCliente = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { nombreNegocio, email, password, plan, diasCubiertos } = request.data;

    if (!nombreNegocio || !email || !password) {
        throw new HttpsError("invalid-argument", "Faltan datos: nombreNegocio, email o password.");
    }
    if (password.length < 6) {
        throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
    }

    let userRecord;
    try {
        userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: nombreNegocio,
        });
    } catch (err) {
        if (err.code === "auth/email-already-exists") {
            throw new HttpsError("already-exists", "Ya existe un cliente con ese email.");
        }
        throw new HttpsError("internal", "No se pudo crear el usuario.");
    }

    const dias = Number(diasCubiertos) || 30;
    const ahora = new Date();
    const vencimiento = new Date(ahora);
    vencimiento.setDate(vencimiento.getDate() + dias);

    await db.collection("clientes").doc(userRecord.uid).set({
        nombreNegocio,
        email,
        estado: "activo",
        plan: plan || "basico",
        fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
        fechaUltimoPago: admin.firestore.FieldValue.serverTimestamp(),
        fechaVencimiento: admin.firestore.Timestamp.fromDate(vencimiento),
        creadoPor: request.auth.uid,
    });

    return { ok: true, uid: userRecord.uid };
});

/**
 * Activa un cliente.
 */
exports.activarCliente = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { clienteId } = request.data;
    if (!clienteId) {
        throw new HttpsError("invalid-argument", "Falta clienteId.");
    }

    await db.collection("clientes").doc(clienteId).update({
        estado: "activo",
        actualizadoPor: request.auth.uid,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
});

/**
 * Desactiva un cliente (bloquea su acceso al POS).
 */
exports.desactivarCliente = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { clienteId, motivo } = request.data;
    if (!clienteId) {
        throw new HttpsError("invalid-argument", "Falta clienteId.");
    }

    await db.collection("clientes").doc(clienteId).update({
        estado: "inactivo",
        motivoDesactivacion: motivo || "No especificado",
        actualizadoPor: request.auth.uid,
        actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
});

/**
 * Registra un nuevo pago y actualiza la fecha de vencimiento del cliente.
 */
exports.registrarPago = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { clienteId, monto, metodoPago, diasCubiertos } = request.data;
    if (!clienteId || !monto || !diasCubiertos) {
        throw new HttpsError("invalid-argument", "Faltan datos: clienteId, monto o diasCubiertos.");
    }

    const clienteRef = db.collection("clientes").doc(clienteId);
    const clienteSnap = await clienteRef.get();

    if (!clienteSnap.exists) {
        throw new HttpsError("not-found", "Cliente no encontrado.");
    }

    const ahora = new Date();
    const vencimientoActual = clienteSnap.data().fechaVencimiento
        ? clienteSnap.data().fechaVencimiento.toDate()
        : ahora;

    const baseFecha = vencimientoActual > ahora ? vencimientoActual : ahora;
    const nuevoVencimiento = new Date(baseFecha);
    nuevoVencimiento.setDate(nuevoVencimiento.getDate() + Number(diasCubiertos));

    await db.collection("pagos").add({
        clienteId,
        monto,
        metodoPago: metodoPago || "No especificado",
        fechaPago: admin.firestore.FieldValue.serverTimestamp(),
        diasCubiertos,
    });

    await clienteRef.update({
        fechaUltimoPago: admin.firestore.FieldValue.serverTimestamp(),
        fechaVencimiento: admin.firestore.Timestamp.fromDate(nuevoVencimiento),
        estado: "activo",
    });

    return { ok: true, nuevoVencimiento: nuevoVencimiento.toISOString() };
});

/**
 * Reclama la sesión activa para este dispositivo/navegador.
 * Si otro dispositivo ya estaba logueado, queda invalidado: al escribir acá,
 * su sessionId local deja de coincidir con el de Firestore y se cierra solo.
 * La llama cualquier cliente autenticado sobre su propio documento (no admins).
 */
exports.registrarSesion = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debés iniciar sesión.");
    }

    const { sessionId, dispositivo } = request.data;
    if (!sessionId) {
        throw new HttpsError("invalid-argument", "Falta sessionId.");
    }

    const clienteRef = db.collection("clientes").doc(request.auth.uid);
    const clienteSnap = await clienteRef.get();
    if (!clienteSnap.exists) {
        throw new HttpsError("not-found", "Cliente no encontrado.");
    }

    await clienteRef.update({
        sesionActiva: {
            sessionId,
            dispositivo: dispositivo || "Desconocido",
            iniciadoEn: admin.firestore.FieldValue.serverTimestamp(),
        },
    });

    return { ok: true };
});

/**
 * Elimina un cliente por completo: borra el usuario de Firebase Auth
 * y su documento de Firestore. Acción irreversible.
 */
exports.eliminarCliente = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { clienteId } = request.data;
    if (!clienteId) {
        throw new HttpsError("invalid-argument", "Falta clienteId.");
    }

    try {
        await admin.auth().deleteUser(clienteId);
    } catch (err) {
        // Si el usuario de Auth ya no existe, igual seguimos y limpiamos Firestore
        if (err.code !== "auth/user-not-found") {
            throw new HttpsError("internal", "No se pudo eliminar el usuario de Auth.");
        }
    }

    await db.collection("clientes").doc(clienteId).delete();
    // El historial de pagos se conserva (colección "pagos") como registro contable,
    // aunque el cliente ya no exista. Si preferís borrarlo también, se puede sumar acá.

    return { ok: true };
});

/**
 * Genera una nueva contraseña para un cliente existente y la devuelve
 * una única vez, para que el admin se la pueda pasar al cliente.
 * No queda guardada en ningún lado en texto plano.
 */
exports.restablecerPassword = onCall(async (request) => {
    await verificarAdmin(request.auth);

    const { clienteId } = request.data;
    if (!clienteId) {
        throw new HttpsError("invalid-argument", "Falta clienteId.");
    }

    const nuevaPassword = Math.random().toString(36).slice(-10) + "A1";

    try {
        await admin.auth().updateUser(clienteId, { password: nuevaPassword });
    } catch (err) {
        throw new HttpsError("internal", "No se pudo actualizar la contraseña.");
    }

    return { ok: true, nuevaPassword };
});

/**
 * Tarea programada: revisa diariamente clientes vencidos y los marca como "vencido".
 */
exports.revisarVencimientos = onSchedule("every 24 hours", async () => {
    const ahora = admin.firestore.Timestamp.now();
    const snapshot = await db
        .collection("clientes")
        .where("estado", "==", "activo")
        .where("fechaVencimiento", "<", ahora)
        .get();

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { estado: "vencido" });
    });
    await batch.commit();

    console.log(`Clientes marcados como vencidos: ${snapshot.size}`);
});