import test from "node:test";
import assert from "node:assert/strict";
import {
  adicionarItemCardapio,
  bibliotecaItensCardapio,
  chaveItemCardapio,
  deduplicarItensCardapio,
  itensTextoCardapio
} from "./menuLibrary.js";

test("remove duplicados do cardápio ignorando maiúsculas e acentos", () => {
  assert.deepEqual(
    deduplicarItensCardapio(["Arroz", " arroz ", "FEIJÃO", "Feijao", "Carne assada"]),
    ["Arroz", "FEIJÃO", "Carne assada"]
  );
  assert.equal(chaveItemCardapio("  Feijão  "), "feijao");
});

test("mantém cada item do texto em uma única linha", () => {
  assert.deepEqual(itensTextoCardapio("Arroz\n\nFeijão\nArroz"), ["Arroz", "Feijão"]);
  assert.equal(adicionarItemCardapio("Arroz\nFeijão", "CARNE"), "Arroz\nFeijão\nCARNE");
  assert.equal(adicionarItemCardapio("Arroz\nFeijão", " arroz "), "Arroz\nFeijão");
});

test("monta biblioteca única a partir do histórico diário", () => {
  const biblioteca = bibliotecaItensCardapio([
    { dataISO: "2026-08-28", itens: ["Arroz", "Feijão", "Carne"] },
    { dataISO: "2026-08-29", itens: ["Arroz", "Salada"] }
  ]);
  assert.deepEqual(biblioteca, ["Arroz", "Salada", "Feijão", "Carne"]);
});
