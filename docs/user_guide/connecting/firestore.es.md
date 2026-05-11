---
title: Google Firestore
summary: "Conectate a Google Cloud Firestore con Beekeeper Studio"
icon: simple/googlecloud
description: "Usa Beekeeper Studio para navegar, consultar y editar colecciones y documentos de Firestore"
---

# Soporte de Firestore

!!! warning "Funcion Beta"
El soporte de Firestore esta en beta. Reporta problemas en [GitHub](https://github.com/beekeeper-studio/beekeeper-studio/issues).

## Requisitos previos

Conectarse a Firestore requiere una cuenta de servicio de Google Cloud con los permisos adecuados:

1. Ve a la [Consola de Firebase &rarr; Cuentas de servicio](https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk)
2. Crea una cuenta de servicio o selecciona una existente
3. Genera y descarga un nuevo archivo JSON de clave privada

Para desarrollo local, tambien puedes conectarte al Firebase Emulator en lugar de a un proyecto real de Google Cloud.

## Rol IAM minimo

**Cloud Datastore User**

Este rol proporciona acceso de lectura/escritura a documentos de Firestore. Para operaciones administrativas (crear indices, gestionar reglas de seguridad), usa **Cloud Datastore Owner** o **Firebase Admin**.

## Conectarse desde Beekeeper Studio

### Metodos de autenticacion

Beekeeper Studio soporta tres metodos de autenticacion para Firestore:

1. **Clave de cuenta de servicio** — pega el contenido JSON directamente, o proporciona la ruta al archivo JSON descargado
2. **Credenciales predeterminadas de aplicacion (ADC)** — usa `gcloud auth application-default login` si ya esta configurado en tu maquina
3. **Firebase Emulator** — se conecta a un emulador local de Firestore sin usar una clave de cuenta de servicio

### Configuracion de conexion

| Campo                        | Requerido | Descripcion                                                                          |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------ |
| Metodo de autenticacion      | Si        | Clave de cuenta de servicio, ADC o Firebase Emulator                                 |
| JSON de cuenta de servicio   | No\*      | Pega el contenido de tu archivo JSON de clave de servicio                            |
| Ruta del archivo de servicio | No\*      | Ruta absoluta a tu archivo `.json` de clave                                          |
| Host del emulador            | No\*\*    | Host y puerto del emulador de Firestore, por ejemplo `localhost:8080`                |
| ID del proyecto              | No        | Auto-detectado de la cuenta de servicio. Sobreescribe si es necesario                |
| ID de base de datos          | No        | Por defecto `(default)`. Especifica una base de datos con nombre si esta configurada |

\*Se requiere JSON o ruta de archivo cuando se usa autenticacion por clave de cuenta de servicio.

\*\*Se usa solo cuando el Metodo de autenticacion es Firebase Emulator.

!!! tip "ID del proyecto"
El ID del proyecto se extrae automaticamente de tu JSON de cuenta de servicio. Solo sobreescribelo si necesitas conectarte a un proyecto diferente.

!!! tip "Firebase Emulator"
Cuando uses Firebase Emulator, configura el host del emulador de Firestore en Beekeeper Studio, por ejemplo `localhost:8080`. Firebase Auth usa el mismo host con el puerto `9099`.

## Consultar Firestore

Firestore usa una sintaxis de consulta basada en codigo, no SQL. En el editor de consultas, usa la sintaxis del Firebase Admin SDK:

```js
db.collection("users").get();

db.collection("users").where("age", ">", 18).orderBy("name").limit(10).get();

db.collectionGroup("posts").where("published", "==", true).get();
```

Tambien puedes ejecutar:

-   `list collections` — muestra todas las colecciones en la base de datos
-   `"nombreDeColeccion"` — navega una sola coleccion por nombre

## Funciones soportadas

-   Navegar colecciones y documentos
-   Ver y editar datos de documentos
-   Ordenar y filtrar en la vista de datos
-   Crear y eliminar colecciones
-   Duplicar colecciones
-   Edicion de celdas en linea
-   Autocompletado de consultas para colecciones y campos
-   Paginacion basada en cursor

### Tipos especificos de Firestore

Los tipos especiales de Firestore se muestran en un formato legible:

| Tipo              | Formato de visualizacion                            |
| ----------------- | --------------------------------------------------- |
| Timestamp         | `YYYY-MM-DD HH:mm:ss.SSS`                           |
| GeoPoint          | `latitud, longitud`                                 |
| DocumentReference | Ruta de coleccion (ej. `users/abc123`)              |
| Array             | JSON serializado                                    |
| Map               | Aplanado con notacion de punto (ej. `address.city`) |

## Limitaciones

Las siguientes funciones no estan disponibles para conexiones Firestore:

-   Consultas SQL (usa la sintaxis tipo JS del SDK en su lugar)
-   Edicion de estructura de tabla (Firestore no tiene esquema)
-   Gestion de indices (administrado via Consola de Google Cloud)
-   Tuneles SSH
-   Exportacion e importacion de datos
-   Respaldo y restauracion desde el servidor
-   Triggers y rutinas almacenadas

## Gestion de autenticacion

Las conexiones Firestore incluyen una pestana de **Autenticacion** integrada para gestionar usuarios de Firebase Auth:

-   Ver, buscar y paginar usuarios
-   Crear nuevos usuarios con email/contraseña
-   Editar detalles de usuario (nombre, estado deshabilitado)
-   Eliminar usuarios

Accede a la pestana de Autenticacion desde la barra lateral cuando estes conectado a una base de datos Firestore.

La gestion de Firebase Auth depende de que Firebase Auth este disponible para la conexion actual. Las conexiones al emulador usan el mismo host que Firestore y conectan con Firebase Auth en el puerto `9099`.
