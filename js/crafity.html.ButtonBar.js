/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function ButtonBar() {
			this.addClass("buttonBar");
		}

		ButtonBar.prototype = new html.Element("div");
		html.ButtonBar = ButtonBar;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
