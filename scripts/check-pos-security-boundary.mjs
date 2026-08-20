import {
  readFileSync,
  readdirSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

const root =
  resolve(
    import.meta.dirname,
    ".."
  );

function read(relativePath) {
  return readFileSync(
    resolve(
      root,
      relativePath
    ),
    "utf8"
  );
}

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

function listSourceFiles(
  relativeDirectory
) {
  const directory =
    resolve(
      root,
      relativeDirectory
    );

  return readdirSync(
    directory,
    {
      withFileTypes: true,
    }
  ).flatMap(
    (entry) => {
      const relativePath =
        relativeDirectory +
        "/" +
        entry.name;

      if (
        entry.isDirectory()
      ) {
        return listSourceFiles(
          relativePath
        );
      }

      return /\.[cm]?[jt]sx?$/.test(
        entry.name
      )
        ? [relativePath]
        : [];
    }
  );
}

const protectedCollections = [
  [
    "productos",
    "productoId",
  ],
  [
    "ventas",
    "ventaId",
  ],
  [
    "cajas",
    "cajaId",
  ],
  [
    "configuracion",
    "configId",
  ],
];

for (
  const rulesPath of [
    "firestore.rules",
    "src/firebase/Firebase.rules",
  ]
) {
  const rules =
    read(
      rulesPath
    );

  for (
    const [
      collection,
      documentId,
    ] of protectedCollections
  ) {
    const matcher =
      new RegExp(
        "match \\/" +
        collection +
        "\\/\\{" +
        documentId +
        "\\} \\{[\\s\\S]*?" +
        "allow create, update, delete: if false;"
      );

    assert(
      matcher.test(
        rules
      ),
      rulesPath +
        " debe denegar create/update/delete en " +
        collection
    );
  }
}

const browserWritePrimitives =
  /\b(?:addDoc|arrayUnion|deleteDoc|runTransaction|serverTimestamp|setDoc|updateDoc|writeBatch)\b/;

for (
  const sourcePath of
    listSourceFiles(
      "src"
    )
) {
  const source =
    read(
      sourcePath
    );

  assert(
    !browserWritePrimitives.test(
      source
    ),
    sourcePath +
      " volvió a incorporar una primitiva de escritura Firestore"
  );
}

const backend =
  read(
    "functions/index.js"
  );

assert(
  backend.includes(
    "exports.guardarNombreNegocio"
  ),
  "Falta el callable guardarNombreNegocio"
);

assert(
  backend.includes(
    "exports.migrarPosLegacy"
  ),
  "Falta el callable migrarPosLegacy"
);

console.log(
  "Límite de seguridad POS verificado"
);
