/**
 * Lanza el snapshot de bestsellers. Lo ejecuta el cron de Render.
 *
 * Antes esto era un `curl` escrito a mano en el campo "Docker Command" de
 * Render. No funcionaba: la imagen es node:20-alpine y Alpine no trae curl, asi
 * que el contenedor moria con exit 128 sin llegar a lanzar nada. Vive aqui para
 * que el comando se pueda leer y versionar como el resto del codigo.
 *
 * Variables de entorno (ya definidas en el cron):
 *   APP_PUBLIC_URL   base de la app, sin barra final
 *   SNAPSHOT_SECRET  secreto que exige /snapshot
 *   SNAPSHOT_LIMITS  opcional, por defecto 19,40,60,100
 *   SNAPSHOT_TIMEOUT opcional, segundos antes de cortar; por defecto 1800
 */

const base = process.env.APP_PUBLIC_URL;
const secret = process.env.SNAPSHOT_SECRET;
const limits = process.env.SNAPSHOT_LIMITS || '19,40,60,100';
const timeoutS = Number(process.env.SNAPSHOT_TIMEOUT || 1800);

if (!base || !secret) {
  console.error(
    'Falta configuracion: ' +
      [!base && 'APP_PUBLIC_URL', !secret && 'SNAPSHOT_SECRET'].filter(Boolean).join(' y '),
  );
  process.exit(1);
}

const url = new URL('/snapshot', base);
url.searchParams.set('secret', secret);
url.searchParams.set('limits', limits);

// Para los logs, sin el secreto.
const visible = new URL(url);
visible.searchParams.set('secret', '***');

const arranque = Date.now();
console.log(`GET ${visible} (corte a los ${timeoutS}s)`);

const corte = AbortSignal.timeout(timeoutS * 1000);

let res;
try {
  // /snapshot solo expone `loader`, asi que es GET. Con POST responde 405.
  res = await fetch(url, { signal: corte });
} catch (err) {
  const segundos = Math.round((Date.now() - arranque) / 1000);
  const porCorte = err?.name === 'TimeoutError' || corte.aborted;
  console.error(
    porCorte
      ? `Cortado a los ${segundos}s sin respuesta. El snapshot sigue corriendo en el servidor; relanza el cron para continuar.`
      : `Fallo la peticion a los ${segundos}s: ${err?.message || err}`,
  );
  process.exit(1);
}

const cuerpo = await res.text();
const segundos = Math.round((Date.now() - arranque) / 1000);
console.log(`status:${res.status} bytes:${cuerpo.length} en ${segundos}s`);
console.log(cuerpo.slice(0, 4000));

if (!res.ok) process.exit(1);

// `complete:false` no es un fallo: es que se agoto el presupuesto de tiempo y
// quedan segmentos. Se avisa, pero el run termina bien para no ensuciar Render.
try {
  const json = JSON.parse(cuerpo);
  if (json?.complete === false) {
    console.warn(
      `Incompleto: quedan ${JSON.stringify(json.pending ?? [])}. Relanza el cron para seguir.`,
    );
  }
} catch {
  // Si no es JSON, el status ya ha dicho lo que habia que decir.
}
