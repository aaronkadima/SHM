/** Public course catalogue is deployed only at the production Pages root.
 * Vite dev preview uses /SHM/dev/; both channels must link to /SHM/aulas/.
 */
const siteBase=(import.meta.env.BASE_URL||"/").replace(/dev\/?$/,"");
export const AULAS_HREF=siteBase+"aulas/";
