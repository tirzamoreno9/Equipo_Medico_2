/* Sistema de Consulta de Equipamiento Médico por Establecimiento de Salud
 * Frontend estático — sin backend. Los "endpoints" son archivos JSON
 * generados por webapp/etl.py a partir de las bases fuente (CLUES, SINERHIAS,
 * equipo médico general y EMAT). Todo el filtrado ocurre en el navegador
 * sobre el archivo de la entidad seleccionada (nunca sobre las 24,208
 * fichas a la vez).
 */
(() => {
  "use strict";

  const $main = document.getElementById("main");
  const PAGE_SIZE = 20;

  const MODOS = {
    establecimiento: { titulo: "Buscar por establecimiento", icono: "🏥",
      desc: "Localiza un establecimiento por entidad, jurisdicción y municipio y consulta su ficha completa." },
    servicio: { titulo: "Buscar por servicio médico", icono: "🩺",
      desc: "Encuentra establecimientos con una especialidad médica específica." },
    equipo_general: { titulo: "Buscar por equipo médico general", icono: "🧰",
      desc: "Encuentra establecimientos que cuentan con un tipo de equipo médico de uso general." },
    equipo_emat: { titulo: "Buscar por equipo de alta tecnología (EMAT)", icono: "🛰️",
      desc: "Localiza equipo especializado y de alto costo: imagenología avanzada, medicina nuclear, radioterapia, braquiterapia y hemodinamia." },
    ubicacion: { titulo: "Buscar por ubicación", icono: "📍",
      desc: "Consulta todos los establecimientos disponibles en una entidad, jurisdicción o municipio." },
  };

  // ---------------------------------------------------------------- estado
  const cache = { entidades: null, indicadores: null, catEquipoGeneral: null, catEmat: null, catEspecialidades: null, shards: {} };
  const MAPA_CENTRO_MEXICO = [23.6345, -102.5528];
  let mapaActivo = null; // instancia Leaflet activa (resultados o ficha), para poder liberarla al navegar

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("No se pudo cargar " + url);
    return r.json();
  }

  async function cargarBase() {
    const [entidades, indicadores, catG, catE, catEsp] = await Promise.all([
      fetchJSON("data/entidades.json"),
      fetchJSON("data/indicadores.json"),
      fetchJSON("data/catalogo_equipo_general.json"),
      fetchJSON("data/catalogo_emat.json"),
      fetchJSON("data/catalogo_especialidades.json"),
    ]);
    cache.entidades = entidades;
    cache.indicadores = indicadores;
    cache.catEquipoGeneral = catG;
    cache.catEmat = catE;
    cache.catEspecialidades = catEsp;
  }

  async function cargarEntidad(clave) {
    if (cache.shards[clave]) return cache.shards[clave];
    const meta = cache.entidades.find((e) => e.clave === clave);
    const data = await fetchJSON("data/" + meta.archivo);
    cache.shards[clave] = data;
    return data;
  }

  async function cargarTodasEntidades() {
    if (cache.todas) return cache.todas;
    const arrs = await Promise.all(cache.entidades.map((e) => cargarEntidad(e.clave)));
    cache.todas = arrs.flat();
    return cache.todas;
  }

  async function cargarUniverso(clave) {
    return clave === "TODAS" ? cargarTodasEntidades() : cargarEntidad(clave);
  }

  function metaEntidad(clave) {
    if (clave === "TODAS") {
      if (!cache._metaTodas) {
        cache._metaTodas = {
          clave: "TODAS",
          nombre: "Todas las entidades (nacional)",
          n_establecimientos: cache.entidades.reduce((s, e) => s + e.n_establecimientos, 0),
          municipios: [...new Set(cache.entidades.flatMap((e) => e.municipios))].sort((a, b) => a.localeCompare(b, "es")),
          jurisdicciones: [],
        };
      }
      return cache._metaTodas;
    }
    return cache.entidades.find((e) => e.clave === clave);
  }

  function entidadOpcionTexto(clave) {
    if (!clave) return "";
    if (clave === "TODAS") return `🌎 Todas las entidades (nacional) — ${fmtNum(cache.indicadores.n_establecimientos)} establecimientos`;
    const e = cache.entidades.find((x) => x.clave === clave);
    return e ? `${e.nombre} (${e.n_establecimientos} establecimientos)` : "";
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtNum(n) {
    if (n === null || n === undefined) return "";
    return Number(n).toLocaleString("es-MX");
  }

  // -------------------------------------------------------------- routing
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    const params = new URLSearchParams(qs || "");
    return { path: path || "inicio", params };
  }
  function navigate(path, params) {
    const qs = params ? new URLSearchParams(params).toString() : "";
    location.hash = "/" + path + (qs ? "?" + qs : "");
  }
  window.addEventListener("hashchange", render);

  // -------------------------------------------------------------- layout
  function setNavActivo(path) {
    document.querySelectorAll("#nav-principal button").forEach((b) => {
      b.removeAttribute("aria-current");
      if (b.dataset.nav === path || (path === "buscar" && b.dataset.nav === "inicio") || (path === "ficha" && b.dataset.nav === "inicio")) {
        // el tab "Inicio" no se marca activo en subrutas
      }
      if (b.dataset.nav === path) b.setAttribute("aria-current", "true");
    });
  }
  document.getElementById("nav-principal").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-nav]");
    if (b) navigate(b.dataset.nav);
  });

  // ------------------------------------------------------------- render
  async function render() {
    const { path, params } = parseHash();
    setNavActivo(path);
    liberarMapa();
    try {
      if (!cache.entidades) {
        $main.innerHTML = `<div class="estado-vacio">Cargando datos base…</div>`;
        await cargarBase();
      }
      if (path === "inicio") return renderInicio();
      if (path === "cobertura") return renderCobertura();
      if (path === "buscar") return renderBuscar(params);
      if (path === "ficha") return renderFicha(params);
      if (path === "reporte-emat") return renderReporteEmatFuera(params);
      return renderInicio();
    } catch (err) {
      console.error(err);
      $main.innerHTML = `<div class="panel"><div class="aviso advertencia">⚠️ Ocurrió un error al cargar la información. Intente de nuevo. (${esc(err.message)})</div></div>`;
    }
  }

  function renderInicio() {
    const i = cache.indicadores;
    $main.innerHTML = `
      <section class="hero">
        <h2>Consulta de equipamiento, capacidad hospitalaria, especialidades y recursos humanos</h2>
        <p>Seleccione un tipo de consulta para localizar establecimientos de salud por entidad federativa, jurisdicción sanitaria y municipio.
        Toda la información proviene de los catálogos oficiales CLUES y SINERHIAS; consulte el bloque «Fuente y actualización» de cada ficha.</p>
      </section>

      <div class="indicadores">
        ${indicadorHTML(fmtNum(i.n_establecimientos), "Establecimientos en operación")}
        ${indicadorHTML(i.n_entidades, "Entidades federativas")}
        ${indicadorHTML(fmtNum(i.n_municipios), "Municipios con establecimientos")}
        ${indicadorHTML(fmtNum(i.n_jurisdicciones), "Jurisdicciones sanitarias")}
        ${indicadorHTML(fmtNum(i.n_camas_habilitadas), "Camas habilitadas")}
        ${indicadorHTML(fmtNum(i.n_plazas_ocupadas_medicas_especialistas), "Plazas médicas ocupadas")}
        ${indicadorHTML(fmtNum(i.n_unidades_equipo_general), "Unidades de equipo general")}
        ${indicadorHTML(fmtNum(i.n_equipos_emat), "Equipos EMAT registrados")}
      </div>

      <button class="indicador indicador-link" id="btn-ver-emat-fuera" style="width:100%;margin-bottom:26px;display:flex;align-items:center;justify-content:space-between;gap:14px">
        <span><span class="num" style="color:var(--ambar-700)">${fmtNum(i.n_equipos_emat_fuera_operacion)}</span>
        <span class="lbl">equipos EMAT fuera de operación, en ${fmtNum(i.n_establecimientos_con_emat_fuera_operacion)} establecimientos — ver el listado completo con motivos</span></span>
      </button>

      <div class="modos" id="modos"></div>
    `;
    document.getElementById("btn-ver-emat-fuera").addEventListener("click", () => navigate("reporte-emat"));
    const $modos = document.getElementById("modos");
    Object.entries(MODOS).forEach(([clave, m]) => {
      const btn = document.createElement("button");
      btn.className = "modo-card";
      btn.innerHTML = `<div class="icono">${m.icono}</div><h3>${m.titulo}</h3><p>${m.desc}</p>`;
      btn.addEventListener("click", () => navigate("buscar", { modo: clave }));
      $modos.appendChild(btn);
    });
  }
  function indicadorHTML(num, lbl) {
    return `<div class="indicador"><div class="num">${num}</div><div class="lbl">${esc(lbl)}</div></div>`;
  }

  function renderCobertura() {
    const i = cache.indicadores;
    $main.innerHTML = `
      <div class="panel">
        <h2>Cobertura y fuentes de información</h2>
        <p class="sub">Fecha de última generación de esta consulta: ${esc(i.fecha_generacion)} (formato AAAA-MM-DD).</p>
        <div class="grid-info" style="margin-bottom:16px">
          <div><b>Universo de la plataforma</b>${fmtNum(i.n_establecimientos)} establecimientos públicos en operación</div>
          <div><b>Con información SINERHIAS</b>${fmtNum(i.n_establecimientos_con_sinerhias)} de ${fmtNum(i.n_establecimientos)} (${Math.round(100 * i.n_establecimientos_con_sinerhias / i.n_establecimientos)}%)</div>
          <div><b>Tipos de equipo general</b>${i.n_tipos_equipo_general}</div>
          <div><b>Conceptos EMAT registrados</b>${(cache.catEmat || []).length}</div>
          <div><b>Especialidades con personal registrado</b>${i.n_especialidades}</div>
          <div><b>Equipos EMAT fuera de operación</b>${fmtNum(i.n_equipos_emat_fuera_operacion)} de ${fmtNum(i.n_equipos_emat)} (${Math.round(100 * i.n_equipos_emat_fuera_operacion / i.n_equipos_emat)}%), en ${fmtNum(i.n_establecimientos_con_emat_fuera_operacion)} establecimientos</div>
        </div>
        <div class="aviso advertencia">
          ⚠️ Los establecimientos sin información SINERHIAS existen y están en operación, pero no reportan camas, recursos humanos ni
          equipo al subsistema; sus fichas muestran esta ausencia de forma explícita — nunca como cero.
        </div>
        <div class="aviso advertencia">
          ⚠️ ${fmtNum(i.n_equipos_emat_fuera_operacion)} equipos EMAT (${Math.round(100 * i.n_equipos_emat_fuera_operacion / i.n_equipos_emat)}% del total registrado) están fuera de operación.
          <button class="btn secundario" id="btn-ir-reporte-emat" style="margin-top:8px">Ver el listado completo con motivos →</button>
        </div>
        <h3 style="font-size:14px;color:var(--inst-900)">Fuentes utilizadas</h3>
        <ul style="font-size:13px;color:var(--gris-700)">
          ${i.fuentes.map((f) => `<li>${esc(f)}</li>`).join("")}
        </ul>
        <h3 style="font-size:14px;color:var(--inst-900)">Alcance y restricciones</h3>
        <ul style="font-size:13px;color:var(--gris-700)">
          <li>No se incluyen CLUES privados ni fuera de operación.</li>
          <li>Los recursos humanos se reportan como <b>plazas</b> (posiciones autorizadas u ocupadas), no como número de personas.</li>
          <li>Las camas se reportan como <b>habilitadas / no habilitadas</b> por categoría; no se usa el término "disponibles" porque
          ninguna fuente registra ocupación en tiempo real. Las cunas se excluyen del conteo de camas.</li>
          <li>El equipo médico general (conteo por establecimiento y tipo) y el Equipo Médico de Alta Tecnología —EMAT— (un registro
          por equipo físico) son catálogos independientes y nunca se combinan en una misma cifra.</li>
          <li>No se muestra información personal de pacientes ni de personal (nombres de médicos por equipo, expedientes, etc.).</li>
        </ul>
      </div>
    `;
    document.getElementById("btn-ir-reporte-emat").addEventListener("click", () => navigate("reporte-emat"));
  }

  // ----------------------------------------------- reporte EMAT fuera de operación
  async function renderReporteEmatFuera(params) {
    const entidadFiltro = params.get("entidad") || "";
    const texto = (params.get("q") || "").toLocaleLowerCase("es-MX");
    const pagina = parseInt(params.get("pagina") || "1", 10);

    $main.innerHTML = `
      <div class="migas">
        <button id="lnk-inicio">Inicio</button> › <span>EMAT fuera de operación</span>
      </div>
      <div class="reporte-cabecera">
        <h2>⚠ Equipo Médico de Alta Tecnología (EMAT) fuera de operación</h2>
        <p>Listado nacional de cada equipo EMAT registrado como no funcional, con el establecimiento donde se encuentra y el motivo capturado en la fuente. Un renglón por equipo físico.</p>
        <div class="reporte-filtros">
          <div class="campo">
            <label for="rep-sel-entidad">Entidad federativa</label>
            <select id="rep-sel-entidad">
              <option value="">Todas las entidades</option>
              ${cache.entidades.map((e) => `<option value="${e.clave}" ${e.clave === entidadFiltro ? "selected" : ""}>${esc(e.nombre)}</option>`).join("")}
            </select>
          </div>
          <div class="campo">
            <label for="rep-texto">Buscar por equipo, establecimiento o motivo</label>
            <input type="text" id="rep-texto" placeholder="p. ej. tomógrafo, falta de personal…" value="${esc(params.get("q") || "")}">
          </div>
        </div>
      </div>
      <div id="zona-reporte"><div class="estado-vacio">Cargando información de las 32 entidades…</div></div>
    `;
    document.getElementById("lnk-inicio").addEventListener("click", () => navigate("inicio"));

    const aplicarFiltros = () => {
      const ent = document.getElementById("rep-sel-entidad").value;
      const q = document.getElementById("rep-texto").value.trim();
      navigate("reporte-emat", { entidad: ent, q, pagina: "1" });
    };
    document.getElementById("rep-sel-entidad").addEventListener("change", aplicarFiltros);
    let debounce;
    document.getElementById("rep-texto").addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(aplicarFiltros, 350);
    });

    const universo = entidadFiltro ? await cargarEntidad(entidadFiltro) : await cargarTodasEntidades();

    // aplana un renglón por equipo EMAT fuera de operación, con el contexto de su establecimiento
    let filas = [];
    for (const e of universo) {
      for (const x of e.equipo_emat) {
        if (!equipoFuera(x)) continue;
        filas.push({ est: e, eq: x });
      }
    }
    if (texto) {
      filas = filas.filter(({ est, eq }) =>
        est.nombre.toLocaleLowerCase("es-MX").includes(texto) ||
        eq.nombre.toLocaleLowerCase("es-MX").includes(texto) ||
        (eq.motivo_no_funciona || "").toLocaleLowerCase("es-MX").includes(texto)
      );
    }
    filas.sort((a, b) => a.est.entidad.localeCompare(b.est.entidad, "es") || a.est.nombre.localeCompare(b.est.nombre, "es"));

    const REP_PAGE_SIZE = 40;
    const total = filas.length;
    const totalPaginas = Math.max(1, Math.ceil(total / REP_PAGE_SIZE));
    const pag = Math.min(Math.max(1, pagina), totalPaginas);
    const pageItems = filas.slice((pag - 1) * REP_PAGE_SIZE, pag * REP_PAGE_SIZE);

    const $zona = document.getElementById("zona-reporte");
    if (!total) {
      $zona.innerHTML = `<div class="estado-vacio"><div class="icono">✓</div><div><b>No se encontraron equipos EMAT fuera de operación</b></div><p>Con los filtros actuales no hay resultados. Intenta quitar la entidad o el texto de búsqueda.</p></div>`;
      return;
    }

    const filasHtml = pageItems.map(({ est, eq }) => `
      <tr>
        <td><a class="clues-link" href="#/ficha?clues=${est.clues}&entidad=${est.entidad_clave}">${esc(est.nombre)}</a><br><span style="color:var(--gris-500);font-size:11px">${est.clues} · ${esc(est.municipio)}, ${esc(est.entidad)}</span></td>
        <td>${esc(eq.nombre)}${eq.marca ? `<br><span style="color:var(--gris-500);font-size:11px">${esc(eq.marca)}${eq.modelo ? " · " + esc(eq.modelo) : ""}</span>` : ""}</td>
        <td class="motivo">${eq.motivo_no_funciona ? esc(eq.motivo_no_funciona) : "Motivo sin capturar"}</td>
      </tr>
    `).join("");

    $zona.innerHTML = `
      <div class="contador-resultados">${fmtNum(total)} equipo${total === 1 ? "" : "s"} EMAT fuera de operación encontrado${total === 1 ? "" : "s"}</div>
      <div class="panel" style="padding:0">
        <div class="wrap-tabla">
          <table class="tabla-reporte">
            <thead><tr><th>Establecimiento</th><th>Equipo</th><th>Motivo</th></tr></thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
      </div>
      <div class="paginacion" id="rep-paginacion"></div>
    `;

    const $pag = document.getElementById("rep-paginacion");
    if (totalPaginas > 1) {
      let html = "";
      for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || Math.abs(i - pag) <= 2) {
          html += `<button data-p="${i}" ${i === pag ? 'aria-current="true"' : ""}>${i}</button>`;
        } else if (Math.abs(i - pag) === 3) {
          html += `<span>…</span>`;
        }
      }
      $pag.innerHTML = html;
      $pag.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-p]");
        if (!b) return;
        navigate("reporte-emat", { entidad: entidadFiltro, q: texto, pagina: b.dataset.p });
      });
    }
  }

  // ---------------------------------------------------------- buscar/filtros
  function renderBuscar(params) {
    const modo = params.get("modo") || "establecimiento";
    const m = MODOS[modo];
    const entidadSel = params.get("entidad") || "";
    const municipioSel = params.get("municipio") || "";
    const jurisdiccionSel = params.get("jurisdiccion") || "";
    const criterioSel = params.get("criterio") || "";
    const pagina = parseInt(params.get("pagina") || "1", 10);
    const buscarYa = params.get("buscar") === "1";
    const soloCon = {
      emat: params.get("soloEmat") === "1",
      equipoGeneral: params.get("soloEquipoGeneral") === "1",
      camas: params.get("soloCamas") === "1",
      rh: params.get("soloRh") === "1",
      ematFuera: params.get("soloEmatFuera") === "1",
    };
    const muestraFiltroCobertura = modo === "establecimiento" || modo === "ubicacion";

    const entidadMeta = entidadSel ? metaEntidad(entidadSel) : null;
    const esNacional = entidadSel === "TODAS";

    $main.innerHTML = `
      <div class="migas">
        <button id="lnk-inicio">Inicio</button> › <span>${esc(m.titulo)}</span>
      </div>
      <div class="panel">
        <h2>${m.icono} ${esc(m.titulo)}</h2>
        <p class="sub">${esc(m.desc)}</p>

        <div class="campo">
          <label for="in-entidad">Entidad federativa</label>
          <p style="font-size:12px;color:var(--gris-500);margin:0 0 8px">Escribe para buscar, o selecciona de la lista completa.</p>
          <div class="combobox" id="combo-entidad">
            <input type="text" id="in-entidad" placeholder="Escriba el nombre de una entidad, o «todas»…" autocomplete="off"
              value="${esc(entidadOpcionTexto(entidadSel))}">
            <input type="hidden" id="sel-entidad-valor" value="${esc(entidadSel)}">
            <div class="lista-opciones oculto" id="lista-entidades"></div>
          </div>
        </div>

        <div id="filtros-territorio" class="${entidadMeta ? "" : "oculto"}">
          <div class="grupo-filtros">
            <fieldset>
              <legend>Municipio (opcional)</legend>
              <div class="combobox" id="combo-municipio">
                <input type="text" id="in-municipio" placeholder="Escriba para buscar un municipio…" autocomplete="off"
                  value="${municipioSel ? esc(municipioSel) : ""}">
                <div class="lista-opciones oculto" id="lista-municipios"></div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Jurisdicción sanitaria (opcional)</legend>
              ${esNacional
                ? `<p style="font-size:12px;color:var(--gris-500);margin:6px 0 0">Selecciona una entidad específica para filtrar por jurisdicción.</p>`
                : `<select id="sel-jurisdiccion">
                    <option value="">Todas las jurisdicciones</option>
                    ${entidadMeta ? entidadMeta.jurisdicciones.map((j) => `<option value="${j.clave}" ${j.clave === jurisdiccionSel ? "selected" : ""}>${esc(j.nombre)}</option>`).join("") : ""}
                  </select>`
              }
            </fieldset>
          </div>
        </div>

        <div id="paso-criterio" class="${entidadMeta && modo !== "establecimiento" && modo !== "ubicacion" ? "" : "oculto"}">
          ${renderPasoCriterio(modo, criterioSel)}
        </div>

        <div id="filtro-cobertura" class="${entidadMeta && muestraFiltroCobertura ? "" : "oculto"}">
          <div class="campo">
            <label>Mostrar de un vistazo qué tiene cada establecimiento</label>
            <div class="chips-filtro">
              <label class="chip-check"><input type="checkbox" id="chk-emat" ${soloCon.emat ? "checked" : ""}> Solo con equipo EMAT</label>
              <label class="chip-check chip-check-alerta"><input type="checkbox" id="chk-emat-fuera" ${soloCon.ematFuera ? "checked" : ""}> ⚠ Solo con EMAT fuera de operación</label>
              <label class="chip-check"><input type="checkbox" id="chk-equipo" ${soloCon.equipoGeneral ? "checked" : ""}> Solo con equipo general</label>
              <label class="chip-check"><input type="checkbox" id="chk-camas" ${soloCon.camas ? "checked" : ""}> Solo con camas registradas</label>
              <label class="chip-check"><input type="checkbox" id="chk-rh" ${soloCon.rh ? "checked" : ""}> Solo con recursos humanos</label>
            </div>
          </div>
        </div>

        <div style="margin-top:18px">
          <button class="btn" id="btn-buscar" ${entidadMeta ? "" : "disabled"}>Ver resultados</button>
        </div>
      </div>

      <div id="zona-resultados"></div>
    `;

    document.getElementById("lnk-inicio").addEventListener("click", () => navigate("inicio"));

    {
      const $inEnt = document.getElementById("in-entidad");
      const $listaEnt = document.getElementById("lista-entidades");
      const opcionesEntidad = [
        { valor: "TODAS", texto: `🌎 Todas las entidades (nacional) — ${fmtNum(cache.indicadores.n_establecimientos)} establecimientos` },
        ...cache.entidades.map((e) => ({ valor: e.clave, texto: `${e.nombre} (${e.n_establecimientos} establecimientos)` })),
      ];
      function mostrarOpcionesEntidad(filtro) {
        const f = (filtro || "").toLocaleLowerCase("es-MX");
        const opciones = opcionesEntidad.filter((o) => o.texto.toLocaleLowerCase("es-MX").includes(f));
        if (!opciones.length) { $listaEnt.classList.add("oculto"); return; }
        $listaEnt.innerHTML = opciones.map((o) => `<div data-valor="${esc(o.valor)}">${esc(o.texto)}</div>`).join("");
        $listaEnt.classList.remove("oculto");
      }
      $inEnt.addEventListener("focus", () => { $inEnt.select(); mostrarOpcionesEntidad(""); });
      $inEnt.addEventListener("input", () => mostrarOpcionesEntidad($inEnt.value));
      $inEnt.addEventListener("blur", () => setTimeout(() => $listaEnt.classList.add("oculto"), 150));
      $listaEnt.addEventListener("mousedown", (ev) => {
        const d = ev.target.closest("[data-valor]");
        if (d) navigate("buscar", { modo, entidad: d.dataset.valor });
      });
    }

    if (entidadMeta) {
      const $inMun = document.getElementById("in-municipio");
      const $listaMun = document.getElementById("lista-municipios");
      function mostrarOpciones(filtro) {
        const f = (filtro || "").toLocaleLowerCase("es-MX");
        const opciones = entidadMeta.municipios.filter((mu) => mu.toLocaleLowerCase("es-MX").includes(f)).slice(0, 60);
        if (!opciones.length) { $listaMun.classList.add("oculto"); return; }
        $listaMun.innerHTML = opciones.map((mu) => `<div data-mun="${esc(mu)}">${esc(mu)}</div>`).join("");
        $listaMun.classList.remove("oculto");
      }
      $inMun.addEventListener("focus", () => mostrarOpciones($inMun.value));
      $inMun.addEventListener("input", () => mostrarOpciones($inMun.value));
      $inMun.addEventListener("blur", () => setTimeout(() => $listaMun.classList.add("oculto"), 150));
      $listaMun.addEventListener("mousedown", (ev) => {
        const d = ev.target.closest("[data-mun]");
        if (d) { $inMun.value = d.dataset.mun; $listaMun.classList.add("oculto"); }
      });

      document.getElementById("btn-buscar").addEventListener("click", () => {
        const p = { modo, entidad: entidadSel, buscar: "1", pagina: "1" };
        if ($inMun.value.trim()) p.municipio = $inMun.value.trim();
        const $jSel = document.getElementById("sel-jurisdiccion");
        if ($jSel && $jSel.value) p.jurisdiccion = $jSel.value;
        const critEl = document.getElementById("sel-criterio");
        if (critEl && critEl.value) p.criterio = critEl.value;
        if (muestraFiltroCobertura) {
          if (document.getElementById("chk-emat").checked) p.soloEmat = "1";
          if (document.getElementById("chk-emat-fuera").checked) p.soloEmatFuera = "1";
          if (document.getElementById("chk-equipo").checked) p.soloEquipoGeneral = "1";
          if (document.getElementById("chk-camas").checked) p.soloCamas = "1";
          if (document.getElementById("chk-rh").checked) p.soloRh = "1";
        }
        navigate("buscar", p);
      });

      const critInput = document.getElementById("in-criterio");
      if (critInput) {
        const $listaCrit = document.getElementById("lista-criterio");
        const catalogo = catalogoPara(modo);
        function mostrarCrit(filtro) {
          const f = (filtro || "").toLocaleLowerCase("es-MX");
          const ops = catalogo.filter((c) => c.nombre.toLocaleLowerCase("es-MX").includes(f)).slice(0, 80);
          $listaCrit.innerHTML = ops.map((c) => `<div data-c="${esc(c.nombre)}">${esc(c.nombre)} <span style="color:var(--gris-500);font-size:11px">(${c.n_establecimientos} est.)</span></div>`).join("");
          $listaCrit.classList.toggle("oculto", !ops.length);
        }
        critInput.addEventListener("focus", () => mostrarCrit(critInput.value));
        critInput.addEventListener("input", () => mostrarCrit(critInput.value));
        critInput.addEventListener("blur", () => setTimeout(() => $listaCrit.classList.add("oculto"), 150));
        $listaCrit.addEventListener("mousedown", (ev) => {
          const d = ev.target.closest("[data-c]");
          if (d) { critInput.value = d.dataset.c; document.getElementById("sel-criterio").value = d.dataset.c; $listaCrit.classList.add("oculto"); }
        });
        const $btnLimpiar = document.getElementById("btn-limpiar-criterio");
        if ($btnLimpiar) {
          $btnLimpiar.addEventListener("click", () => {
            critInput.value = "";
            document.getElementById("sel-criterio").value = "";
            $btnLimpiar.remove();
          });
        }
      }
    }

    if (buscarYa && entidadMeta) {
      mostrarResultados(modo, entidadSel, municipioSel, jurisdiccionSel, criterioSel, pagina, soloCon);
    }
  }

  function catalogoPara(modo) {
    if (modo === "servicio") return cache.catEspecialidades;
    if (modo === "equipo_general") return cache.catEquipoGeneral;
    if (modo === "equipo_emat") return cache.catEmat;
    return [];
  }

  function renderPasoCriterio(modo, criterioSel) {
    if (modo === "establecimiento" || modo === "ubicacion") return "";
    const etiqueta = modo === "servicio" ? "Especialidad médica" : modo === "equipo_general" ? "Tipo de equipo médico general" : "Equipo de alta tecnología (EMAT)";
    return `
      <div class="campo">
        <label for="in-criterio">${etiqueta} <span class="opcional">(opcional)</span></label>
        <p style="font-size:12px;color:var(--gris-500);margin:0 0 8px">Déjalo vacío para ver todos los establecimientos que tienen cualquier ${modo === "servicio" ? "especialidad" : "equipo de este catálogo"} registrado; escribe para buscar un tipo específico.</p>
        <div class="combobox" id="combo-criterio">
          <input type="text" id="in-criterio" placeholder="Escriba para buscar, o déjelo vacío para ver todos…" autocomplete="off" value="${criterioSel ? esc(criterioSel) : ""}">
          <input type="hidden" id="sel-criterio" value="${criterioSel ? esc(criterioSel) : ""}">
          ${criterioSel ? `<button type="button" id="btn-limpiar-criterio" class="btn-limpiar" title="Quitar selección">✕</button>` : ""}
          <div class="lista-opciones oculto" id="lista-criterio"></div>
        </div>
      </div>
    `;
  }

  async function mostrarResultados(modo, entidad, municipio, jurisdiccion, criterio, pagina, soloCon) {
    soloCon = soloCon || {};
    const $zona = document.getElementById("zona-resultados");
    $zona.innerHTML = `<div class="estado-vacio">${entidad === "TODAS" ? "Cargando establecimientos de las 32 entidades…" : "Cargando establecimientos…"}</div>`;
    const shard = await cargarUniverso(entidad);
    let filtrados = shard.filter((e) => (!municipio || e.municipio === municipio) && (!jurisdiccion || e.jurisdiccion_clave === jurisdiccion));
    if (soloCon.emat) filtrados = filtrados.filter((e) => e.equipo_emat.length);
    if (soloCon.ematFuera) filtrados = filtrados.filter((e) => e.equipo_emat.some(equipoFuera));
    if (soloCon.equipoGeneral) filtrados = filtrados.filter((e) => e.equipo_general.length);
    if (soloCon.camas) filtrados = filtrados.filter((e) => e.camas);
    if (soloCon.rh) filtrados = filtrados.filter((e) => e.rh);

    const top = (arr, n) => arr.slice(0, n);
    let extraInfo = () => "";
    if (modo === "servicio") {
      if (criterio) {
        filtrados = filtrados.filter((e) => e.rh && e.rh.especialistas.some((x) => x.especialidad === criterio && x.plazas_ocupadas > 0));
        extraInfo = (e) => {
          const x = e.rh.especialistas.find((s) => s.especialidad === criterio);
          return `<span class="pill destaca">${x.plazas_ocupadas} plaza(s) ocupada(s) de ${x.plazas_autorizadas} autorizada(s)</span>`;
        };
      } else {
        filtrados = filtrados.filter((e) => e.rh && e.rh.especialistas.some((x) => x.plazas_ocupadas > 0 && !["General", "Otros"].includes(x.especialidad)));
        extraInfo = (e) => {
          const esps = e.rh.especialistas.filter((x) => x.plazas_ocupadas > 0 && !["General", "Otros"].includes(x.especialidad));
          const html = top(esps, 4).map((x) => `<span class="pill destaca">${esc(x.especialidad)} · ${x.plazas_ocupadas}</span>`).join("");
          return html + (esps.length > 4 ? `<span class="pill">+${esps.length - 4} especialidad(es) más</span>` : "");
        };
      }
    } else if (modo === "equipo_general") {
      if (criterio) {
        filtrados = filtrados.filter((e) => e.equipo_general.some((x) => x.nombre === criterio));
        extraInfo = (e) => {
          const x = e.equipo_general.find((eq) => eq.nombre === criterio);
          return `<span class="pill destaca">${fmtNum(x.cantidad)} unidad(es) registrada(s)</span>`;
        };
      } else {
        filtrados = filtrados.filter((e) => e.equipo_general.length);
        extraInfo = (e) => {
          const items = e.equipo_general.slice().sort((a, b) => b.cantidad - a.cantidad);
          const html = top(items, 4).map((x) => `<span class="pill destaca">${esc(x.nombre)} · ${fmtNum(x.cantidad)}</span>`).join("");
          return html + (items.length > 4 ? `<span class="pill">+${items.length - 4} tipo(s) más</span>` : "");
        };
      }
    } else if (modo === "equipo_emat") {
      if (criterio) {
        filtrados = filtrados.filter((e) => e.equipo_emat.some((x) => x.nombre === criterio));
        extraInfo = (e) => {
          const items = e.equipo_emat.filter((x) => x.nombre === criterio);
          return items.map((x) => chipEstadoEquipo(x)).join(" ");
        };
      } else {
        filtrados = filtrados.filter((e) => e.equipo_emat.length);
        extraInfo = (e) => {
          const nombres = [...new Set(e.equipo_emat.map((x) => x.nombre))];
          const html = top(nombres, 4).map((n) => {
            const fuera = e.equipo_emat.filter((x) => x.nombre === n).some(equipoFuera);
            return `<span class="pill ${fuera ? "pill-alerta" : "destaca"}">${esc(n)}${fuera ? " ⚠" : ""}</span>`;
          }).join("");
          return html + (nombres.length > 4 ? `<span class="pill">+${nombres.length - 4} más</span>` : "");
        };
      }
    }

    const total = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pagina = Math.min(Math.max(1, pagina), totalPaginas);
    const pageItems = filtrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

    const entidadMeta = metaEntidad(entidad);
    const conSinerhias = filtrados.filter((e) => e.tiene_sinerhias).length;
    const conCamas = filtrados.filter((e) => e.camas).length;
    const conRh = filtrados.filter((e) => e.rh).length;
    const conEquipo = filtrados.filter((e) => e.equipo_general.length).length;
    const conEmat = filtrados.filter((e) => e.equipo_emat.length).length;
    const conEmatFuera = filtrados.filter((e) => e.equipo_emat.some(equipoFuera)).length;

    const algunFiltroCobertura = soloCon.emat || soloCon.ematFuera || soloCon.equipoGeneral || soloCon.camas || soloCon.rh;

    if (!total) {
      $zona.innerHTML = `
        <div class="estado-vacio">
          <div class="icono">🔍</div>
          <div><b>No se encontraron establecimientos</b></div>
          <p>No hay establecimientos que cumplan estos criterios en ${esc(entidadMeta.nombre)}${municipio ? " · " + esc(municipio) : ""}.
          ${algunFiltroCobertura ? "Intente quitar alguno de los filtros «Solo con…», o " : "Intente "}quitar el municipio o la jurisdicción, o busque en otra entidad.</p>
        </div>`;
      return;
    }

    $zona.innerHTML = `
      <div class="banda-cobertura">
        <span><b>${esc(entidadMeta.nombre)}</b>${municipio ? " · " + esc(municipio) : ""}${jurisdiccion ? " · jurisdicción " + esc(entidadMeta.jurisdicciones.find((j) => j.clave === jurisdiccion).nombre) : ""}</span>
        <span>🛰 ${conEmat} con EMAT</span>
        ${conEmatFuera ? `<span class="texto-alerta">⚠ ${conEmatFuera} con EMAT fuera de operación</span>` : ""}
        <span>🧰 ${conEquipo} con equipo general</span>
        <span>🛏 ${conCamas} con camas</span>
        <span>👥 ${conRh} con recursos humanos</span>
        <span>${conSinerhias} de ${total} con información SINERHIAS</span>
      </div>
      <div class="contador-resultados">${total} establecimiento${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}</div>
      <div class="resultados-split">
        <div class="resultados-lista-col">
          <div class="result-list" id="lista-resultados"></div>
          <div class="paginacion" id="paginacion"></div>
        </div>
        <div class="resultados-mapa-col">
          <div id="mapa-resultados" class="mapa-contenedor"></div>
          <p class="mapa-nota" id="mapa-nota"></p>
        </div>
      </div>
    `;

    const $lista = document.getElementById("lista-resultados");
    $lista.innerHTML = pageItems.map((e) => `
      <a class="result-card" href="#/ficha?clues=${e.clues}&entidad=${e.entidad_clave}">
        <span class="titulo">${esc(e.nombre)}</span><span class="clues">${e.clues}</span>
        ${!e.tiene_sinerhias ? '<span class="pill" style="background:var(--ambar-100);color:var(--ambar-700)">Sin información en la fuente</span>' : ""}
        <div class="meta">${esc(e.tipo_establecimiento || "")} · ${esc(e.municipio || "")}, ${esc(e.entidad || "")}${e.jurisdiccion ? " · " + esc(e.jurisdiccion) : ""}</div>
        <div class="extra">${badgesCobertura(e)}${extraInfo(e)}</div>
      </a>
    `).join("");

    inicializarMapaResultados(filtrados);

    const $pag = document.getElementById("paginacion");
    if (totalPaginas > 1) {
      let html = "";
      for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || Math.abs(i - pagina) <= 2) {
          html += `<button data-p="${i}" ${i === pagina ? 'aria-current="true"' : ""}>${i}</button>`;
        } else if (Math.abs(i - pagina) === 3) {
          html += `<span>…</span>`;
        }
      }
      $pag.innerHTML = html;
      $pag.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-p]");
        if (!b) return;
        const p = { modo, entidad, buscar: "1", pagina: b.dataset.p };
        if (municipio) p.municipio = municipio;
        if (jurisdiccion) p.jurisdiccion = jurisdiccion;
        if (criterio) p.criterio = criterio;
        if (soloCon.emat) p.soloEmat = "1";
        if (soloCon.ematFuera) p.soloEmatFuera = "1";
        if (soloCon.equipoGeneral) p.soloEquipoGeneral = "1";
        if (soloCon.camas) p.soloCamas = "1";
        if (soloCon.rh) p.soloRh = "1";
        navigate("buscar", p);
      });
    }
  }

  function equipoFuera(x) {
    return String(x.funcionando || "").toUpperCase() !== "SI";
  }

  function badgesCobertura(e) {
    const b = (ok, iconoTxt, siTxt, noTxt) =>
      ok ? `<span class="pill destaca">${iconoTxt} ${siTxt}</span>` : `<span class="pill pill-ausente">${iconoTxt} ${noTxt}</span>`;
    const nEmat = e.equipo_emat.length;
    const nEmatFuera = e.equipo_emat.filter(equipoFuera).length;
    let badgeEmat;
    if (!nEmat) {
      badgeEmat = `<span class="pill pill-ausente">🛰 sin EMAT</span>`;
    } else if (nEmatFuera) {
      badgeEmat = `<span class="pill pill-alerta" title="Ver bloque 7 de la ficha para el motivo de cada equipo">🛰 ${nEmat} EMAT · ⚠ ${nEmatFuera} fuera de operación</span>`;
    } else {
      badgeEmat = `<span class="pill destaca">🛰 ${nEmat} EMAT · todos en funcionamiento</span>`;
    }
    return [
      b(!!e.camas, "🛏", `${fmtNum(e.camas ? e.camas.total_habilitadas : 0)} camas`, "sin camas"),
      b(!!e.rh, "👥", `${fmtNum(e.rh ? e.rh.total_plazas_ocupadas : 0)} plazas`, "sin RH"),
      b(e.equipo_general.length > 0, "🧰", `${e.equipo_general.length} tipo(s) de equipo`, "sin equipo general"),
      badgeEmat,
    ].join("");
  }

  function chipEstadoEquipo(x) {
    if (!equipoFuera(x)) return `<span class="status-chip ok">✓ En funcionamiento</span>`;
    return `<span class="status-chip no">✕ Fuera de operación — ${x.motivo_no_funciona ? esc(x.motivo_no_funciona) : "motivo sin capturar"}</span>`;
  }

  // -------------------------------------------------------------- mapa
  function liberarMapa() {
    if (mapaActivo) {
      mapaActivo.remove();
      mapaActivo = null;
    }
  }

  const MAX_MARCADORES_MAPA = 4000;

  function popupEstablecimiento(e) {
    return `
      <div class="popup-est">
        <b>${esc(e.nombre)}</b>
        <div class="fila">${esc(e.nivel_atencion) || "Nivel de atención sin capturar"}</div>
        <div class="fila">${esc(e.institucion) || ""}</div>
        <div class="fila">${esc(e.municipio)}, ${esc(e.entidad)}</div>
        <a class="ver-ficha" href="#/ficha?clues=${e.clues}&entidad=${e.entidad_clave}">Ver ficha completa →</a>
      </div>
    `;
  }

  function inicializarMapaResultados(establecimientos) {
    const $div = document.getElementById("mapa-resultados");
    const $nota = document.getElementById("mapa-nota");
    if (!$div || typeof L === "undefined") return;
    liberarMapa();

    if (establecimientos.length > MAX_MARCADORES_MAPA) {
      $div.innerHTML = `<div class="mapa-aviso">Hay ${fmtNum(establecimientos.length)} establecimientos — son demasiados para mostrar en el mapa a la vez. Acota con un municipio, jurisdicción o alguno de los filtros «Solo con…» para verlos aquí.</div>`;
      if ($nota) $nota.textContent = "";
      return;
    }

    const conCoords = establecimientos.filter((e) => {
      const lat = parseFloat(e.lat), lon = parseFloat(e.lon);
      return e.lat && e.lon && !isNaN(lat) && !isNaN(lon);
    });
    const sinCoords = establecimientos.length - conCoords.length;

    $div.innerHTML = "";
    const map = L.map($div, { scrollWheelZoom: true }).setView(MAPA_CENTRO_MEXICO, 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    if (conCoords.length) {
      const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 });
      const bounds = [];
      conCoords.forEach((e) => {
        const lat = parseFloat(e.lat), lon = parseFloat(e.lon);
        bounds.push([lat, lon]);
        const marker = L.marker([lat, lon]);
        marker.bindPopup(popupEstablecimiento(e), { maxWidth: 260 });
        cluster.addLayer(marker);
      });
      map.addLayer(cluster);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }

    mapaActivo = map;
    if ($nota) {
      $nota.textContent = sinCoords
        ? `Mostrando ${fmtNum(conCoords.length)} de ${fmtNum(establecimientos.length)} establecimientos con coordenadas registradas en la fuente (${fmtNum(sinCoords)} sin coordenadas no se pueden ubicar).`
        : `Mostrando ${fmtNum(conCoords.length)} establecimiento${conCoords.length === 1 ? "" : "s"} en el mapa.`;
    }
  }

  function inicializarMapaFicha(e) {
    const $div = document.getElementById("mapa-ficha");
    if (!$div || typeof L === "undefined") return;
    const lat = parseFloat(e.lat), lon = parseFloat(e.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    const map = L.map($div, { scrollWheelZoom: false }).setView([lat, lon], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    L.marker([lat, lon]).addTo(map).bindPopup(`<b>${esc(e.nombre)}</b>`);
    mapaActivo = map;
  }

  // -------------------------------------------------------------- ficha
  async function renderFicha(params) {
    const clues = params.get("clues");
    const entidadClave = params.get("entidad") || clues.slice(0, 2);
    $main.innerHTML = `<div class="estado-vacio">Cargando ficha…</div>`;
    const shard = await cargarEntidad(entidadClave);
    const e = shard.find((x) => x.clues === clues);
    if (!e) {
      $main.innerHTML = `<div class="panel"><div class="aviso advertencia">No se encontró el establecimiento ${esc(clues)}.</div></div>`;
      return;
    }

    const direccion = [e.vialidad, e.num_ext, e.asentamiento, e.cp ? "C.P. " + e.cp : null].filter(Boolean).join(", ");
    const sinSinerhias = !e.tiene_sinerhias;

    $main.innerHTML = `
      <div class="migas">
        <button id="lnk-inicio">Inicio</button> › <button id="lnk-atras">Resultados</button> › <span>${esc(e.nombre)}</span>
      </div>

      <div class="ficha-cabecera">
        <h2>${esc(e.nombre)}</h2>
        <span class="tag-clues">CLUES ${e.clues}</span>
        <div class="meta-linea">${esc(e.tipo_establecimiento || "")}${e.nivel_atencion ? " · Nivel de atención: " + esc(e.nivel_atencion) : ""} · ${esc(e.institucion || "")}</div>
      </div>

      <nav class="toc-ficha" aria-label="Ir a sección de la ficha">
        <button data-ir="bloque-1">1. Información</button>
        <button data-ir="bloque-2">2. Ubicación</button>
        <button data-ir="bloque-3">3. Camas</button>
        <button data-ir="bloque-4">4. Rec. humanos</button>
        <button data-ir="bloque-5">5. Servicios</button>
        <button data-ir="bloque-6">6. Equipo general</button>
        <button data-ir="bloque-7">7. EMAT</button>
        <button data-ir="bloque-8">8. Fuente</button>
      </nav>

      ${sinSinerhias ? `<div class="aviso advertencia">⚠️ Este establecimiento está en operación pero no reporta información a SINERHIAS: no se muestran camas, recursos humanos, especialidades ni equipo porque la fuente no tiene datos — no porque el valor sea cero.</div>` : ""}

      <details class="bloque" id="bloque-1" open>
        <summary><span class="n">1</span>Información general<span class="flecha">▾</span></summary>
        <div class="contenido">
          <div class="grid-info">
            <div><b>Nombre de la unidad</b>${esc(e.nombre)}</div>
            <div><b>Nombre comercial</b>${esc(e.nombre_comercial) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
            <div><b>Tipo de establecimiento</b>${esc(e.tipo_establecimiento)}</div>
            <div><b>Tipología / subtipología</b>${esc(e.tipologia)}${e.subtipologia ? " — " + esc(e.subtipologia) : ""}</div>
            <div><b>Nivel de atención</b>${esc(e.nivel_atencion) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
            <div><b>Institución</b>${esc(e.institucion)}</div>
            <div><b>Estatus de operación</b>${esc(e.estatus_operacion)}</div>
            <div><b>Teléfono</b>${esc(e.telefono) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
          </div>
        </div>
      </details>

      <details class="bloque" id="bloque-2" open>
        <summary><span class="n">2</span>Ubicación<span class="flecha">▾</span></summary>
        <div class="contenido">
          <div class="grid-info">
            <div><b>Entidad federativa</b>${esc(e.entidad)}</div>
            <div><b>Jurisdicción sanitaria</b>${esc(e.jurisdiccion) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
            <div><b>Municipio</b>${esc(e.municipio)}</div>
            <div><b>Localidad</b>${esc(e.localidad) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
            <div><b>Dirección</b>${esc(direccion) || '<span class="dv dv-ausente">Sin capturar</span>'}</div>
            <div><b>Coordenadas geográficas</b>${e.lat && e.lon ? `${esc(e.lat)}, ${esc(e.lon)}` : '<span class="dv dv-ausente">Sin coordenadas en la fuente</span>'}</div>
          </div>
          ${e.lat && e.lon ? `
            <p style="margin-top:12px"><a class="btn secundario" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.lat},${e.lon}">Ver en Google Maps ↗</a></p>
            <div id="mapa-ficha" class="mapa-contenedor mapa-ficha"></div>
          ` : ""}
        </div>
      </details>

      ${renderBloqueCamas(e)}
      ${renderBloqueRH(e)}
      ${renderBloqueServicios(e)}
      ${renderBloqueEquipoGeneral(e)}
      ${renderBloqueEmat(e)}

      <details class="bloque" id="bloque-8" open>
        <summary><span class="n">8</span>Fuente y actualización<span class="flecha">▾</span></summary>
        <div class="contenido">
          <div class="grid-info">
            <div><b>Fecha de última actualización</b>${e.fecha_actualizacion ? esc(e.fecha_actualizacion.slice(0, 10).split("-").reverse().join("/")) : '<span class="dv dv-ausente">Sin información en la fuente</span>'}</div>
            <div><b>Fuente</b>Catálogo CLUES / SINERHIAS — Dirección General de Información en Salud</div>
            <div><b>Reporta a SINERHIAS</b>${sinSinerhias ? "No" : "Sí"}</div>
          </div>
        </div>
      </details>

      <div class="acciones-finales">
        <button class="btn secundario" id="btn-nueva">Nueva consulta</button>
        <button class="btn" id="btn-fin">Finalizar</button>
      </div>
    `;

    document.getElementById("lnk-inicio").addEventListener("click", () => navigate("inicio"));
    document.getElementById("lnk-atras").addEventListener("click", () => history.back());
    document.getElementById("btn-nueva").addEventListener("click", () => navigate("inicio"));
    document.getElementById("btn-fin").addEventListener("click", () => navigate("inicio"));
    document.querySelector(".toc-ficha").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-ir]");
      if (!b) return;
      const destino = document.getElementById(b.dataset.ir);
      if (!destino) return;
      if (destino.tagName === "DETAILS") destino.open = true;
      destino.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    if (e.lat && e.lon) inicializarMapaFicha(e);
  }

  function avisoSinCaptura(texto) {
    return `<div class="aviso info">${texto}</div>`;
  }

  function renderBloqueCamas(e) {
    if (!e.tiene_sinerhias) {
      return `<details class="bloque" id="bloque-3"><summary><span class="n">3</span>Camas<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin información en la fuente (el establecimiento no reporta a SINERHIAS).")}</div></details>`;
    }
    if (!e.camas || !e.camas.categorias.length) {
      return `<details class="bloque" id="bloque-3" open><summary><span class="n">3</span>Camas<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin captura de camas para este establecimiento.")}</div></details>`;
    }
    const filas = e.camas.categorias.map((c) => `<tr><td>${esc(c.categoria)}</td><td>${fmtNum(c.habilitadas)}</td><td>${fmtNum(c.no_habilitadas)}</td></tr>`).join("");
    return `<details class="bloque" id="bloque-3" open><summary><span class="n">3</span>Camas<span class="flecha">▾</span></summary>
      <div class="contenido">
        <p style="font-size:13px;color:var(--gris-700)">Camas habilitadas por categoría (no incluye cunas). Total habilitadas: <b>${fmtNum(e.camas.total_habilitadas)}</b> · No habilitadas: <b>${fmtNum(e.camas.total_no_habilitadas)}</b>.</p>
        <div class="wrap-tabla"><table class="tabla-medida"><thead><tr><th>Categoría</th><th>Habilitadas</th><th>No habilitadas</th></tr></thead><tbody>${filas}</tbody></table></div>
      </div></details>`;
  }

  function renderBloqueRH(e) {
    if (!e.tiene_sinerhias) {
      return `<details class="bloque" id="bloque-4"><summary><span class="n">4</span>Recursos humanos (plazas)<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin información en la fuente (el establecimiento no reporta a SINERHIAS).")}</div></details>`;
    }
    if (!e.rh) {
      return `<details class="bloque" id="bloque-4"><summary><span class="n">4</span>Recursos humanos (plazas)<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin captura de recursos humanos para este establecimiento.")}</div></details>`;
    }
    const filasGrupo = e.rh.grupos.map((g) => `<tr><td>${esc(g.grupo)}</td><td>${fmtNum(g.plazas_ocupadas)}</td><td>${fmtNum(g.plazas_autorizadas)}</td></tr>`).join("");
    const filasEsp = e.rh.especialistas.map((s) => `<tr><td>${esc(s.especialidad)}</td><td>${fmtNum(s.plazas_ocupadas)}</td><td>${fmtNum(s.plazas_autorizadas)}</td></tr>`).join("");
    return `<details class="bloque" id="bloque-4"><summary><span class="n">4</span>Recursos humanos (plazas)<span class="flecha">▾</span></summary>
      <div class="contenido">
        <p style="font-size:13px;color:var(--gris-700)">Cifras en <b>plazas</b> (posiciones), no en número de personas. Total de plazas ocupadas: <b>${fmtNum(e.rh.total_plazas_ocupadas)}</b> de ${fmtNum(e.rh.total_plazas_autorizadas)} autorizadas.</p>
        <h4 style="font-size:12.5px;color:var(--gris-700);margin:14px 0 4px">Por grupo de personal</h4>
        <div class="wrap-tabla"><table class="tabla-medida"><thead><tr><th>Grupo</th><th>Ocupadas</th><th>Autorizadas</th></tr></thead><tbody>${filasGrupo}</tbody></table></div>
        <h4 style="font-size:12.5px;color:var(--gris-700);margin:14px 0 4px">Médicos generales, odontólogos y especialistas — plazas por especialidad</h4>
        <div class="wrap-tabla"><table class="tabla-medida"><thead><tr><th>Especialidad</th><th>Ocupadas</th><th>Autorizadas</th></tr></thead><tbody>${filasEsp || '<tr><td colspan="3">Sin captura por especialidad.</td></tr>'}</table></div>
      </div></details>`;
  }

  function renderBloqueServicios(e) {
    if (!e.tiene_sinerhias) {
      return `<details class="bloque" id="bloque-5"><summary><span class="n">5</span>Servicios y especialidades médicas<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin información en la fuente (el establecimiento no reporta a SINERHIAS).")}</div></details>`;
    }
    const especialidades = e.rh ? e.rh.especialistas.filter((s) => s.plazas_ocupadas > 0 && !["General", "Otros"].includes(s.especialidad)) : [];
    return `<details class="bloque" id="bloque-5"><summary><span class="n">5</span>Servicios y especialidades médicas<span class="flecha">▾</span></summary>
      <div class="contenido">
        <p style="font-size:12.5px;color:var(--gris-700)">Evidencia a partir de plazas médicas especialistas ocupadas registradas en SINERHIAS (no equivale a licencia sanitaria de servicio).</p>
        ${especialidades.length ? `<div class="extra">${especialidades.map((s) => `<span class="pill destaca">${esc(s.especialidad)} · ${s.plazas_ocupadas} plaza(s)</span>`).join("")}</div>` : avisoSinCaptura("Sin especialidades con personal médico registrado.")}
      </div></details>`;
  }

  function renderBloqueEquipoGeneral(e) {
    if (!e.equipo_general.length) {
      return `<details class="bloque" id="bloque-6"><summary><span class="n">6</span>Equipo médico general<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura(e.tiene_sinerhias ? "Sin captura de equipo médico general." : "Sin información en la fuente (el establecimiento no reporta a SINERHIAS).")}</div></details>`;
    }
    const filas = e.equipo_general.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((x) => `<tr><td>${esc(x.nombre)}</td><td>${fmtNum(x.cantidad)}</td></tr>`).join("");
    return `<details class="bloque" id="bloque-6"><summary><span class="n">6</span>Equipo médico general<span class="flecha">▾</span></summary>
      <div class="contenido">
        <p style="font-size:12.5px;color:var(--gris-700)">Equipo de uso común (consultorios, urgencias, hospitalización, quirófanos y demás áreas). Conteo por tipo, no incluye marca/modelo/número de serie.</p>
        <div class="wrap-tabla"><table class="tabla-medida"><thead><tr><th>Equipo</th><th>Cantidad registrada</th></tr></thead><tbody>${filas}</tbody></table></div>
      </div></details>`;
  }

  function renderBloqueEmat(e) {
    if (!e.equipo_emat.length) {
      return `<details class="bloque" id="bloque-7"><summary><span class="n">7</span>Equipo Médico de Alta Tecnología (EMAT)<span class="flecha">▾</span></summary>
        <div class="contenido">${avisoSinCaptura("Sin equipo de alta tecnología registrado para este establecimiento.")}</div></details>`;
    }
    const nFuera = e.equipo_emat.filter(equipoFuera).length;
    // fuera de operación primero, para que sea lo primero que se vea al abrir el bloque
    const ordenados = e.equipo_emat.slice().sort((a, b) => equipoFuera(b) - equipoFuera(a));
    const filas = ordenados.map((x) => `<tr class="${equipoFuera(x) ? "fila-alerta" : ""}">
        <td>${esc(x.nombre)}</td><td>${esc(x.marca) || "—"}</td><td>${esc(x.modelo) || "—"}</td><td>${esc(x.numero_serie) || "—"}</td>
        <td>${esc(x.servicio) || "—"}</td><td>${chipEstadoEquipo(x)}</td>
      </tr>`).join("");
    return `<details class="bloque" id="bloque-7" ${nFuera ? "open" : ""}><summary><span class="n">7</span>Equipo Médico de Alta Tecnología (EMAT)${nFuera ? `<span class="badge-resumen alerta">⚠ ${nFuera} fuera de operación</span>` : ""}<span class="flecha">▾</span></summary>
      <div class="contenido">
        <p style="font-size:12.5px;color:var(--gris-700)">Un renglón por equipo físico. Marca, modelo y número de serie tal como fueron capturados en la fuente (sin normalizar).
        ${nFuera ? ` Los equipos fuera de operación se muestran primero, con el motivo capturado en la columna Estado.` : ""}</p>
        <div class="wrap-tabla"><table class="tabla-medida"><thead><tr><th>Equipo</th><th>Marca</th><th>Modelo</th><th>No. de serie</th><th>Servicio</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>
      </div></details>`;
  }

  render();
})();
