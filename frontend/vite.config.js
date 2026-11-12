import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins:[react()],
  // Workers em ESM: o worker do modo Live importa onnxruntime-web (code-splitting).
  worker:{format:"es"},
  // A paridade da imagem embute backend/app/cdm_v285.py (?raw) no worker do Pyodide.
  server:{fs:{allow:[".."]}},
  base:process.env.VITE_BASE_PATH||"/SHM/"
});
