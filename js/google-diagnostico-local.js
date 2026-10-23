(function () {
  "use strict";

  // Apenas informa o resultado. Nunca recebe tokens.
  window.PEMATO_GOOGLE_DIAGNOSTICO = {
    receberResultado: function (resultado) {
      const status = document.getElementById(
        "pemato-google-diagnostico-status"
      );

      if (!status) return;

      status.textContent =
        resultado === "SELECAO_CONCLUIDA"
          ? "Seleção Google concluída. Nenhum login foi realizado."
          : "Não foi possível concluir a seleção Google.";
    }
  };

  function montarDiagnostico() {
    if (!window.Android ||
        typeof window.Android.selecionarGoogleDiagnostico111Z27 !== "function") {
      return;
    }

    if (document.getElementById("pemato-google-diagnostico-btn")) {
      return;
    }

    const area = document.createElement("div");
    area.style.padding = "12px";
    area.style.textAlign = "center";

    const botao = document.createElement("button");
    botao.id = "pemato-google-diagnostico-btn";
    botao.type = "button";
    botao.textContent = "Testar seletor Google (DEBUG)";

    const status = document.createElement("p");
    status.id = "pemato-google-diagnostico-status";
    status.setAttribute("role", "status");

    botao.addEventListener("click", function () {
      status.textContent = "Abrindo seletor Google...";
      window.Android.selecionarGoogleDiagnostico111Z27();
    });

    area.appendChild(botao);
    area.appendChild(status);

    document.body.appendChild(area);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montarDiagnostico);
  } else {
    montarDiagnostico();
  }
})();
