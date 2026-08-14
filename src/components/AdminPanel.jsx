// src/components/AdminPanel.jsx
// Panel administrativo: ver clientes, estado de licencia y activar/desactivar.
// Requiere que el usuario logueado exista en la colección "admins" de Firestore.

import { useEffect, useState, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, auth } from "../firebase/config";
import { signOut } from "firebase/auth";

const ESTADO_STYLES = {
    activo: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Activo" },
    vencido: { dot: "bg-amber-400", text: "text-amber-300", label: "Vencido" },
    inactivo: { dot: "bg-rose-400", text: "text-rose-300", label: "Inactivo" },
};

function formatearFecha(fecha) {
    if (!fecha) return "—";
    const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AdminPanel() {
    const [clientes, setClientes] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [filtro, setFiltro] = useState("todos");
    const [clienteModal, setClienteModal] = useState(null); // cliente seleccionado para acción
    const [modo, setModo] = useState(null); // "desactivar" | "pago"
    const [mostrarCrear, setMostrarCrear] = useState(false);

    const cargarClientes = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const listar = httpsCallable(functions, "listarClientes");
            const res = await listar();
            setClientes(res.data.clientes);
        } catch (err) {
            setError(err.message || "No se pudo cargar la lista de clientes.");
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        cargarClientes();
    }, [cargarClientes]);

    const clientesFiltrados = clientes.filter((c) => {
        if (filtro === "todos") return true;
        return c.estado === filtro;
    });

    const contador = {
        activo: clientes.filter((c) => c.estado === "activo").length,
        vencido: clientes.filter((c) => c.estado === "vencido").length,
        inactivo: clientes.filter((c) => c.estado === "inactivo").length,
    };

    return (
        <div className="min-h-screen bg-[#0F1B2B] text-[#E4EAF0]">
            <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
                <div>
                    <p className="text-xs tracking-[0.2em] text-[#6B7A8F] uppercase font-mono">Consola de licencias</p>
                    <h1 className="text-xl font-semibold mt-1">Clientes del POS</h1>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setMostrarCrear(true)}
                        className="px-3 py-1.5 rounded-md text-sm font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
                    >
                        + Nuevo cliente
                    </button>
                    <button
                        onClick={() => signOut(auth)}
                        className="text-sm text-[#8B98A5] hover:text-white transition-colors"
                    >
                        Cerrar sesión
                    </button>
                </div>
            </header>

            <main className="px-8 py-6 max-w-6xl mx-auto">
                {/* Resumen */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <ResumenCard label="Activos" valor={contador.activo} color="text-emerald-300" />
                    <ResumenCard label="Vencidos" valor={contador.vencido} color="text-amber-300" />
                    <ResumenCard label="Inactivos" valor={contador.inactivo} color="text-rose-300" />
                </div>

                {/* Filtros */}
                <div className="flex gap-2 mb-4">
                    {["todos", "activo", "vencido", "inactivo"].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFiltro(f)}
                            className={`px-3 py-1.5 rounded-full text-sm font-mono transition-colors ${filtro === f
                                    ? "bg-white/10 text-white"
                                    : "text-[#6B7A8F] hover:text-[#8B98A5]"
                                }`}
                        >
                            {f === "todos" ? "Todos" : ESTADO_STYLES[f]?.label}
                        </button>
                    ))}
                </div>

                {error && (
                    <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
                        {error}
                    </div>
                )}

                {/* Tabla */}
                <div className="rounded-xl border border-white/10 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-white/[0.03] text-left text-[#6B7A8F] font-mono text-xs uppercase tracking-wider">
                                <th className="px-4 py-3 font-medium">Negocio</th>
                                <th className="px-4 py-3 font-medium">Estado</th>
                                <th className="px-4 py-3 font-medium">Último pago</th>
                                <th className="px-4 py-3 font-medium">Vencimiento</th>
                                <th className="px-4 py-3 font-medium text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cargando ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-[#6B7A8F]">
                                        Cargando clientes…
                                    </td>
                                </tr>
                            ) : clientesFiltrados.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-[#6B7A8F]">
                                        No hay clientes en este filtro.
                                    </td>
                                </tr>
                            ) : (
                                clientesFiltrados.map((c) => {
                                    const estilo = ESTADO_STYLES[c.estado] || ESTADO_STYLES.inactivo;
                                    return (
                                        <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{c.nombreNegocio || "Sin nombre"}</div>
                                                <div className="text-[#6B7A8F] text-xs font-mono">{c.email}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center gap-2">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${estilo.dot}`} />
                                                    <span className={estilo.text}>{estilo.label}</span>
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[#B8C2CC]">
                                                {formatearFecha(c.fechaUltimoPago)}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[#B8C2CC]">
                                                {formatearFecha(c.fechaVencimiento)}
                                            </td>
                                            <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                                <button
                                                    onClick={() => { setClienteModal(c); setModo("pago"); }}
                                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                                                >
                                                    Registrar pago
                                                </button>
                                                {c.estado === "activo" || c.estado === "vencido" ? (
                                                    <button
                                                        onClick={() => { setClienteModal(c); setModo("desactivar"); }}
                                                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors"
                                                    >
                                                        Desactivar
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => activarRapido(c.id, cargarClientes)}
                                                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-[#B8C2CC] hover:bg-white/10 transition-colors"
                                                    >
                                                        Activar
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => { setClienteModal(c); setModo("password"); }}
                                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-[#B8C2CC] hover:bg-white/10 transition-colors"
                                                >
                                                    Contraseña
                                                </button>
                                                <button
                                                    onClick={() => { setClienteModal(c); setModo("eliminar"); }}
                                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-[#8B98A5] hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
                                                >
                                                    Eliminar
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </main>

            {clienteModal && modo === "desactivar" && (
                <ModalDesactivar
                    cliente={clienteModal}
                    onClose={() => { setClienteModal(null); setModo(null); }}
                    onDone={cargarClientes}
                />
            )}
            {clienteModal && modo === "pago" && (
                <ModalPago
                    cliente={clienteModal}
                    onClose={() => { setClienteModal(null); setModo(null); }}
                    onDone={cargarClientes}
                />
            )}
            {clienteModal && modo === "password" && (
                <ModalRestablecerPassword
                    cliente={clienteModal}
                    onClose={() => { setClienteModal(null); setModo(null); }}
                />
            )}
            {clienteModal && modo === "eliminar" && (
                <ModalEliminar
                    cliente={clienteModal}
                    onClose={() => { setClienteModal(null); setModo(null); }}
                    onDone={cargarClientes}
                />
            )}
            {mostrarCrear && (
                <ModalCrearCliente
                    onClose={() => setMostrarCrear(false)}
                    onDone={cargarClientes}
                />
            )}
        </div>
    );
}

async function activarRapido(clienteId, onDone) {
    const activar = httpsCallable(functions, "activarCliente");
    await activar({ clienteId });
    onDone();
}

function ResumenCard({ label, valor, color }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
            <p className="text-xs text-[#6B7A8F] font-mono uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-semibold mt-1 font-mono ${color}`}>{valor}</p>
        </div>
    );
}

function ModalDesactivar({ cliente, onClose, onDone }) {
    const [motivo, setMotivo] = useState("");
    const [enviando, setEnviando] = useState(false);

    const confirmar = async () => {
        setEnviando(true);
        try {
            const desactivar = httpsCallable(functions, "desactivarCliente");
            await desactivar({ clienteId: cliente.id, motivo });
            onDone();
            onClose();
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-[#16263B] border border-white/10 rounded-xl p-6 w-full max-w-sm">
                <h2 className="text-base font-semibold mb-1">Desactivar {cliente.nombreNegocio}</h2>
                <p className="text-sm text-[#8B98A5] mb-4">Perderá acceso inmediato al POS.</p>
                <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo (opcional)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:border-white/30"
                    rows={3}
                />
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#8B98A5] hover:text-white">
                        Cancelar
                    </button>
                    <button
                        onClick={confirmar}
                        disabled={enviando}
                        className="px-3 py-1.5 text-sm rounded-md bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 disabled:opacity-50"
                    >
                        {enviando ? "Desactivando…" : "Desactivar"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ModalRestablecerPassword({ cliente, onClose }) {
    const [passwordNueva, setPasswordNueva] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState(null);
    const [copiado, setCopiado] = useState(false);

    const generar = async () => {
        setEnviando(true);
        setError(null);
        try {
            const restablecer = httpsCallable(functions, "restablecerPassword");
            const res = await restablecer({ clienteId: cliente.id });
            setPasswordNueva(res.data.nuevaPassword);
        } catch (err) {
            setError(err.message || "No se pudo generar la nueva contraseña.");
        } finally {
            setEnviando(false);
        }
    };

    const copiar = () => {
        navigator.clipboard.writeText(passwordNueva);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-[#16263B] border border-white/10 rounded-xl p-6 w-full max-w-sm">
                <h2 className="text-base font-semibold mb-1">Contraseña — {cliente.nombreNegocio}</h2>

                {!passwordNueva ? (
                    <>
                        <p className="text-sm text-[#8B98A5] mb-4">
                            Por seguridad, la contraseña actual no se puede ver. Podés generar una nueva
                            y pasársela al cliente.
                        </p>
                        {error && <p className="text-sm text-rose-300 mb-3">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#8B98A5] hover:text-white">
                                Cancelar
                            </button>
                            <button
                                onClick={generar}
                                disabled={enviando}
                                className="px-3 py-1.5 text-sm rounded-md bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
                            >
                                {enviando ? "Generando…" : "Generar nueva contraseña"}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-[#8B98A5] mb-3">
                            Nueva contraseña generada. Se muestra una sola vez — copiala ahora:
                        </p>
                        <div className="flex items-center gap-2 mb-4">
                            <code className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-emerald-300 break-all">
                                {passwordNueva}
                            </code>
                            <button
                                onClick={copiar}
                                className="px-3 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/20 shrink-0"
                            >
                                {copiado ? "Copiado" : "Copiar"}
                            </button>
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 text-sm rounded-md bg-white/10 text-white hover:bg-white/20"
                            >
                                Listo
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function ModalEliminar({ cliente, onClose, onDone }) {
    const [confirmacion, setConfirmacion] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState(null);

    const nombreEsperado = cliente.nombreNegocio || "";
    const puedeConfirmar = confirmacion.trim() === nombreEsperado.trim();

    const confirmar = async () => {
        if (!puedeConfirmar) return;
        setEnviando(true);
        setError(null);
        try {
            const eliminar = httpsCallable(functions, "eliminarCliente");
            await eliminar({ clienteId: cliente.id });
            onDone();
            onClose();
        } catch (err) {
            setError(err.message || "No se pudo eliminar el cliente.");
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-[#16263B] border border-rose-500/30 rounded-xl p-6 w-full max-w-sm">
                <h2 className="text-base font-semibold mb-1 text-rose-300">Eliminar {nombreEsperado}</h2>
                <p className="text-sm text-[#8B98A5] mb-4">
                    Esta acción es irreversible. Se borra el usuario y todos sus datos de acceso.
                    El historial de pagos queda conservado por separado.
                </p>
                <p className="text-xs text-[#8B98A5] mb-2">
                    Escribí <span className="font-mono text-white">{nombreEsperado}</span> para confirmar:
                </p>
                <input
                    type="text"
                    value={confirmacion}
                    onChange={(e) => setConfirmacion(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:border-rose-400/50"
                />
                {error && <p className="text-sm text-rose-300 mb-3">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#8B98A5] hover:text-white">
                        Cancelar
                    </button>
                    <button
                        onClick={confirmar}
                        disabled={!puedeConfirmar || enviando}
                        className="px-3 py-1.5 text-sm rounded-md bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 disabled:opacity-30"
                    >
                        {enviando ? "Eliminando…" : "Eliminar definitivamente"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ModalCrearCliente({ onClose, onDone }) {
    const [nombreNegocio, setNombreNegocio] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [dias, setDias] = useState("30");
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [creado, setCreado] = useState(false);
    const [copiado, setCopiado] = useState(false);

    const confirmar = async () => {
        setError(null);
        setEnviando(true);
        try {
            const crearCliente = httpsCallable(functions, "crearCliente");
            await crearCliente({
                nombreNegocio,
                email,
                password,
                diasCubiertos: Number(dias),
            });
            onDone();
            setCreado(true); // mostramos las credenciales en vez de cerrar
        } catch (err) {
            setError(err.message || "No se pudo crear el cliente.");
        } finally {
            setEnviando(false);
        }
    };

    const copiar = () => {
        navigator.clipboard.writeText(`Email: ${email}\nContraseña: ${password}`);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
    };

    if (creado) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
                <div className="bg-[#16263B] border border-emerald-500/30 rounded-xl p-6 w-full max-w-sm">
                    <h2 className="text-base font-semibold mb-1 text-emerald-300">Cliente creado</h2>
                    <p className="text-sm text-[#8B98A5] mb-4">
                        Guardá estos datos ahora — la contraseña no se va a poder ver de nuevo desde acá.
                    </p>
                    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-3 mb-4 space-y-1">
                        <p className="text-xs text-[#6B7A8F] font-mono uppercase">Email</p>
                        <p className="text-sm font-mono text-white break-all mb-2">{email}</p>
                        <p className="text-xs text-[#6B7A8F] font-mono uppercase">Contraseña</p>
                        <p className="text-sm font-mono text-emerald-300 break-all">{password}</p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={copiar}
                            className="px-3 py-1.5 text-sm rounded-md bg-white/10 text-white hover:bg-white/20"
                        >
                            {copiado ? "Copiado" : "Copiar datos"}
                        </button>
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-sm rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        >
                            Listo
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-[#16263B] border border-white/10 rounded-xl p-6 w-full max-w-sm">
                <h2 className="text-base font-semibold mb-4">Nuevo cliente</h2>

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Nombre del negocio</label>
                <input
                    type="text"
                    value={nombreNegocio}
                    onChange={(e) => setNombreNegocio(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 outline-none focus:border-white/30"
                    placeholder="Almacén Don José"
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 outline-none focus:border-white/30"
                    placeholder="cliente@ejemplo.com"
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Contraseña inicial</label>
                <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 outline-none focus:border-white/30"
                    placeholder="Mínimo 6 caracteres"
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Días de acceso iniciales</label>
                <input
                    type="number"
                    value={dias}
                    onChange={(e) => setDias(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 mt-1 outline-none focus:border-white/30"
                />

                {error && <p className="text-sm text-rose-300 mb-3">{error}</p>}

                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#8B98A5] hover:text-white">
                        Cancelar
                    </button>
                    <button
                        onClick={confirmar}
                        disabled={enviando || !nombreNegocio || !email || !password}
                        className="px-3 py-1.5 text-sm rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                        {enviando ? "Creando…" : "Crear cliente"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ModalPago({ cliente, onClose, onDone }) {
    const [monto, setMonto] = useState("");
    const [dias, setDias] = useState("30");
    const [metodo, setMetodo] = useState("Transferencia");
    const [enviando, setEnviando] = useState(false);

    const confirmar = async () => {
        setEnviando(true);
        try {
            const registrarPago = httpsCallable(functions, "registrarPago");
            await registrarPago({
                clienteId: cliente.id,
                monto: Number(monto),
                diasCubiertos: Number(dias),
                metodoPago: metodo,
            });
            onDone();
            onClose();
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-[#16263B] border border-white/10 rounded-xl p-6 w-full max-w-sm">
                <h2 className="text-base font-semibold mb-4">Registrar pago — {cliente.nombreNegocio}</h2>

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Monto</label>
                <input
                    type="number"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 outline-none focus:border-white/30"
                    placeholder="0.00"
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Días cubiertos</label>
                <input
                    type="number"
                    value={dias}
                    onChange={(e) => setDias(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 mt-1 outline-none focus:border-white/30"
                />

                <label className="text-xs text-[#8B98A5] font-mono uppercase tracking-wider">Método de pago</label>
                <select
                    value={metodo}
                    onChange={(e) => setMetodo(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-4 mt-1 outline-none focus:border-white/30"
                >
                    <option>Transferencia</option>
                    <option>Efectivo</option>
                    <option>Mercado Pago</option>
                    <option>Otro</option>
                </select>

                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#8B98A5] hover:text-white">
                        Cancelar
                    </button>
                    <button
                        onClick={confirmar}
                        disabled={enviando || !monto}
                        className="px-3 py-1.5 text-sm rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                        {enviando ? "Guardando…" : "Confirmar pago"}
                    </button>
                </div>
            </div>
        </div>
    );
}