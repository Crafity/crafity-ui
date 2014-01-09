/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	var html = new crafity.html.Element(document.documentElement).addClass("active");

	if (window.onfocusout !== null) { // Meaning not IE...
		window.addEventListener("blur", function () {
			html.addClass("inactive").removeClass("active");
		});
		window.addEventListener("focus", function () {
			html.addClass("active").removeClass("inactive");
		});
	}

}(window.crafity = window.crafity || {}));
		
		
