# QUICKSTART

Guía corta para operar este repo sin entrar en todos los detalles.

Cada cierto tiempo se actualizan dos fuentes de información:

1. Los datos que están en GoodReads.
2. Los datos que están en BookBuddy. 

Los datos que están en GoodReads cambian casi continuamente porque la gente da likes de modo que es lo primero que hay que hacer.

## A. Actualizar los likes de GoodReads

((Explica como actualizar solo los likes y separa el script que actualiza los likes del que baja las últimas 10 reseñas))

----

Cada cierto tiempo se agregan nuevos libros leídos. Generalmente estos libros no tienen una reseña inmediata, pero deben agregarse a la lista.

## B. Actualizar los libros leídos de GoodReads

((Explica como actualizar los libros leídos. Haz un script que solo sirva para bajar la lista de libros y no sus reseñas. Estos nuevos registros necesitan una clasificación. Agrega a este procedimiento un sencillo proceso de clasificación que encuentre dcc_clases pero no dcc_codes ni reasoning o confidence. Pero deja estos valores vacíos. No se deben modificar los títulos (campo title) que ya están en library.json. Si un bookId ya está en library.json no debe descargarse como libro nuevo))

----

Menos común es que escriba reseñas nuevas o que edite algunas reseñas recientes.

## C. Descargar las últimas 10 reseñas

((Explica como descargar solamente las últimas 10 reseñas. El nuevo script debería intentar bajar las cover de los libros incluso si no tienen reseña.))

----

Los pasos A a C se automatizan en un procedimiento que se corre todos los días automáticamente. 

((Actualiza el launchd para que ejecute los scripts A-C))

----

Ahora que tenemos los últimso libros de GoodReads, podemos ver cómo actualizar los libros agregados a BookBuddy

## D. Actualizar lista de BookBuddy

Descarga de BookBuddy dos archivos: bookbuddy.csv y bookbuddy.htm. De aquí sacaremos los últimos libros agregados y sus portadas.

((Haz un script que lea los archivos y si el ISBN no está en library-details.json agrega la entrada nueva. Corre el procedimiento de clasificación sobre el nuevo libro y agrega dcc_clases pero no dcc_codes ni reasoning o confidence. Pero deja estos valores vacíos. Saca las cover del *.htm))

----

## E. Buscar las cross-references

Con los nuevos libros agregados a library.json y library-details.json y solo con los nuevos libros, correr un script de cross references que mire cuáles son el mismo libro y que ponga el bookId respectivo en library-details.json. 

((Haz el script de modo que la persona pueda ver el matching y si es del caso corregirlo manualmente.))

## F. Clasificar los libros 

Ahora que ya tenemos los nuevos libros en library.json y library-details.json podemos generar los batch files con los libros que no han sido clasificados para subirlos a gemini para que haga la clasificación detallada.

((Haz o modifica el script que mira que libros no tienen clasificación detallada dcc_codes.reasoning vacío para mandarle la info a Gemini))

## G. Aplicar las clasificaciones de Gemini en la biblioteca

Una vez tengamos el archivo json con las clasificaciones ahora se las aplicamos a la biblioteca.

((Revisa el script))

((Para cada paso haz una rule en el Makefile y crea una rule make update-all-books que ejecute todas las rules anteriores ))