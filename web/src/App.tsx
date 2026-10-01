import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { GradoPage } from "./pages/GradoPage";
import { HomePage } from "./pages/HomePage";
import { MySchedulePage } from "./pages/MySchedulePage";
import { SchedulePage } from "./pages/SchedulePage";

function NotFound() {
  return (
    <div className="panel">
      <h1>Página no encontrada</h1>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </div>
  );
}

/** Ruta incompleta (/grado/x/2627/primero...): lleva a la página del grado, que lista todos los horarios. */
function PartialPath() {
  const { slug } = useParams();
  return <Navigate to={`/grado/${slug}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="mi-horario" element={<MySchedulePage />} />
        <Route path="grado/:slug" element={<GradoPage />} />
        <Route path="grado/:slug/:year/:curso/:sem/:grupo" element={<SchedulePage />} />
        <Route path="grado/:slug/*" element={<PartialPath />} />
        <Route path="horario/:id" element={<SchedulePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
