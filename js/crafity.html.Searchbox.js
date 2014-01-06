/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Searchbox(callback) {
			var self = this;

			this._search = new html.Element("input")
				.attr("type", "search")
				.attr("name", "search")
				.attr("results", "5");

			if (callback) {
				this.on("change", callback);
			}

			this._search.addEventListener("keyup", function (e) {
				if (e.which === 13) {
					return;
					/* Handled by search event */
				}
				self.emit("change", self._search.value());
			});
			this._search.addEventListener("search", function () {
				self.emit("change", self._search.value());
			});

			this.append(this._search);
			this.addClass("searchbox");
		}

		Searchbox.prototype = new html.Element("div");
		Searchbox.prototype.focus = function () {
			this._search.focus();
			return this;
		};
		html.Searchbox = Searchbox;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
