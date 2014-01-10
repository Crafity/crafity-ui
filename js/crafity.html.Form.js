/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Form() {
			this.addClass("form");
		}

		Form.prototype = new html.Element("div");
		Form.prototype.verify = function () {
			var isValid = true;
			this.getChildren().filter(function (child) {
				return !!child.verify;
			}).forEach(function (child) {
					isValid = child.verify() && isValid;
				});
			return isValid;
		};
		html.Form = Form;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
