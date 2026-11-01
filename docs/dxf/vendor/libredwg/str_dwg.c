/* STR Bim Tools : conversions DWG <-> DXF pour la visionneuse /dxf/, au-dessus de LibreDWG (GPL 3). */
#include <stdio.h>
#include <string.h>
#include <emscripten/emscripten.h>
#include "dwg.h"
#include "dwg_api.h"
#include "common.h"
#include "bits.h"
#include "out_dxf.h"

/* DWG -> DXF (texte), même version que le DWG. Code d'erreur LibreDWG (>= 128 : bloquant). */
EMSCRIPTEN_KEEPALIVE int str_dwg_vers_dxf(const char *entree, const char *sortie){
  Dwg_Data dwg; Bit_Chain dat;
  int err;
  memset(&dwg, 0, sizeof dwg); memset(&dat, 0, sizeof dat);
  err = dwg_read_file(entree, &dwg);
  if (err >= DWG_ERR_CRITICAL){ dwg_free(&dwg); return err; }
  dat.version = dwg.header.version;
  dat.from_version = dwg.header.from_version;
  dat.fh = fopen(sortie, "wb");
  if (!dat.fh){ dwg_free(&dwg); return DWG_ERR_IOERROR; }
  err |= dwg_write_dxf(&dat, &dwg);
  fclose(dat.fh);
  dwg_free(&dwg);
  return err;
}

/* DXF -> DWG AutoCAD 2000 (seul format que l'écriture DWG de LibreDWG produit). */
EMSCRIPTEN_KEEPALIVE int str_dxf_vers_dwg(const char *entree, const char *sortie){
  Dwg_Data dwg;
  int err;
  memset(&dwg, 0, sizeof dwg);
  dwg.opts = 0;
  dwg.header.version = R_2000;
  err = dxf_read_file(entree, &dwg);
  if (err >= DWG_ERR_CRITICAL){ dwg_free(&dwg); return err; }
  dwg.header.version = R_2000;
  if (dwg.header.from_version == R_INVALID) dwg.header.from_version = R_2000;
  remove(sortie);
  err = dwg_write_file(sortie, &dwg);
  dwg_free(&dwg);
  return err;
}
