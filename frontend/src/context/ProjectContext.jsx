import { createContext, useContext, useMemo, useState } from "react";

const ProjectContext = createContext(null);

export const useProjectContext = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return ctx;
};

export const ProjectProvider = ({ children }) => {
  const [currentProjectId, setCurrentProjectId] = useState(() => {
    const stored = localStorage.getItem("currentProjectId");
    return stored ? Number(stored) : null;
  });

  const value = useMemo(
    () => ({
      currentProjectId,
      setCurrentProjectId: (id) => {
        setCurrentProjectId(id);
        if (id !== null && id !== undefined) {
          localStorage.setItem("currentProjectId", String(id));
        } else {
          localStorage.removeItem("currentProjectId");
        }
      },
    }),
    [currentProjectId]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
};

export default ProjectContext;
