import React from "react";
import DynamicEncuestaChart from "@/components/DynamicEncuestaChart";
import { useParams } from "react-router-dom";

export default function EncuestasPorCliente() {
  const { id } = useParams(); // asume que la ruta pasa el id_proyecto
  return (
    <div className="p-4">
      <h2>Gráfico Dinámico de Encuestas</h2>
      <DynamicEncuestaChart id_proyecto={id} />
    </div>
  );
}
