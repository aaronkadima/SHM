/** Trilha Dev SHM: publicada em cada canal (produção em /SHM/aulas/, desenvolvimento em /SHM/dev/aulas/),
 * para que as duas versões tenham exatamente o mesmo conteúdo e navegação.
 */
export const AULAS_HREF=(import.meta.env.BASE_URL||"/").replace(/\/?$/,"/")+"aulas/";
