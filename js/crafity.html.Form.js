/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Form() {
			this.addClass("form");
			this.on("readonlyChanged", function (value) {
				this.children().forEach(function (child) {
					child.readonly(value);
				});
			});
		}

		Form.prototype = new html.Element("form");
		Form.prototype.addField = function (field) {
			this.append(field);
			return this;
		};
		Form.prototype.verify = function () {
			var isValid = true;
			this.children().filter(function (child) {
				return !!child.verify;
			}).forEach(function (child) {
					isValid = child.verify() && isValid;
				});
			return isValid;
		};
		Form.prototype.focus = function () {
			html.Element.prototype.focus.apply(this, arguments);
			this.children().length && this.children()[0].focus();
			this.children().some(function (child) {
				if (!child.verify()) { child.focus(); }
				return !child.isValid();
			});
			return this;
		};

		Form.prototype.reset = function () {
			this.children().forEach(function (child) {
				child.reset();
			});
			return this;
		};

		html.Form = Form;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
