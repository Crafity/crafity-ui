/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Button(text) {
			var self = this;
			this.addClass("button");
			this.text(text);
			this.getElement().addEventListener("click", function () {
				if (self.disabled()) { return; }
				self.emit("click");
			});
		}

		Button.prototype = new html.Element("a");
		html.Button = Button;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
