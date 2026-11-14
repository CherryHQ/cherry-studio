FROM ubuntu:22.04
RUN apt-get update && apt-get install -y --no-install-recommends g++ pkg-config libglib2.0-dev libgdk-pixbuf-2.0-dev && rm -rf /var/lib/apt/lists/*
COPY include /include
COPY source /src
RUN g++ -std=c++17 -O2 -shared -fPIC -pthread -DNAPI_VERSION=8 -DNAPI_CPP_EXCEPTIONS -I/include/node-api-headers -I/include/node-addon-api /src/addon.cpp /src/linux/externalApp.cpp /src/linux/icons.cpp -o /external-app.node $(pkg-config --cflags --libs gio-unix-2.0 gdk-pixbuf-2.0) -ldl
CMD ["cp", "/external-app.node", "/out/external-app.node"]
