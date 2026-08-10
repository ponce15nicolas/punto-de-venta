import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePosData } from "./hooks/usePosData";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import Vender from "./pages/Vender";
import Inventario from "./pages/Inventario";
import Caja from "./pages/Caja";
import Historial from "./pages/Historial";

export default function App() {
  const pos = usePosData();
  const [tab, setTab] = useState("vender");
  const [invFilter, setInvFilter] = useState("all");

  function goInventario(filter) {
    setInvFilter(filter);
    setTab("inventario");
  }

  if (!pos.loaded) {
    return <div className="min-h-screen bg-bg" />;
  }

  return (
    <div className="min-h-screen bg-bg pb-[78px]">
      <Header
        shopName={pos.shopName}
        openSession={pos.openSession}
        onRename={() => {
          const name = prompt("Nombre del negocio:", pos.shopName);
          if (name && name.trim()) pos.setShopName(name.trim());
        }}
      />
      <main className="max-w-[520px] mx-auto px-3.5 pt-3.5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.16 }}
          >
            {tab === "vender" && <Vender pos={pos} goInventario={goInventario} />}
            {tab === "inventario" && <Inventario pos={pos} filter={invFilter} setFilter={setInvFilter} />}
            {tab === "caja" && <Caja pos={pos} />}
            {tab === "historial" && <Historial pos={pos} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <BottomNav tab={tab} setTab={setTab} />
      <Toast toast={pos.toastMsg} onDone={() => {}} />
    </div>
  );
}
